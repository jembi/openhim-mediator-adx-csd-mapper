#!/usr/bin/env node
'use strict'

const Dom = require('xmldom').DOMParser
const Ser = require('xmldom').XMLSerializer
const http = require('http')
const utils = require('openhim-mediator-utils')
const xpath = require('xpath')

// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = require('./config/config')
const mediatorConfig = require('./config/mediator')

/**
 * Extracts the orgUnits from an ADX message
 * @param {string} adx - the adx message to extract from
 * @param {function} callback - a callback(err, orgUnits) that gets called with
 * an error object if an error occurs and orgUnits which is a Set of orgUnit ID
 * string.
 */
function extractOrgUnitIds (adx) {
  const doc = new Dom().parseFromString(adx)
  const select = xpath.useNamespaces({'adx': 'urn:ihe:qrph:adx:2015'})
  const nodes = select('//adx:adx/adx:group/@orgUnit', doc)
  let orgUnits = new Set()
  nodes.forEach(function (node) {
    orgUnits.add(node.value)
  })
  return orgUnits
}

/**
 * Fetches a single facility from the InfoMan by otherId, the response is sent
 * to the callback as a full CSD XML response.
 * @param {string} orgUnitId - the ID of the facility that you wish to fetch
 * @param {Function} callback - the node style callback to call with the body
 * of the CSD response containing a facility, or null if one does not exist
 */
function fetchFacility (orgUnitId, callback) {
  var options = {
    hostname: config.infoman.host,
    port: config.infoman.port,
    path: config.infoman.path,
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml'
    }
  }

  let req = http.request(options, function (res) {
    let body = ''
    res.on('data', function (chunk) {
      body += chunk.toString()
    })
    res.on('end', function () {
      callback(null, body)
    })
  })

  req.on('error', function (err) {
    callback(err)
  })

  let body = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                <csd:otherID>${orgUnitId}</csd:otherID>
              </csd:requestParams>`

  req.write(body)
  req.end()
}

/**
 * getEntityIDNodes - extract entity ID nodes from a particular resource in CSD
 *
 * @param  {string} resource   the CSD resource. Possible values are 'facility', 'organization', 'provider' or 'service'.
 * @param  {DOM}    doc        An xml document as a DOM object.
 * @return {Array}             An array of attribute nodes for each entityID
 */
function getEntityIDNodes (resource, doc) {
  const select = xpath.useNamespaces({'csd': 'urn:ihe:iti:csd:2013'})
  const nodes = select(`//csd:CSD/csd:${resource}Directory/csd:${resource}/@entityID`, doc)
  return nodes
}

/**
 * Fetches a map of local IDs to enterprise IDs from the InfoMan
 * @param {Array} orgUnits - An array of orgUnits IDs as strings
 * @param {Function} callback - A calllback that will be called with an error
 * object if an error occurs and a map with each map element containing the
 * orgUnitId as a key and the corresponding enterprise ID as a value. If an
 * enterprise ID cannot be found for an item, it value in the map will be null.
 */
function fetchMap (orgUnits, callback) {
  let map = new Map()
  const promises = []
  orgUnits.forEach(function (orgUnitId) {
    const promise = new Promise(function (resolve, reject) {
      function errorHandler (e) {
        console.error(e)
        return reject(e)
      }

      fetchFacility(orgUnitId, function (err, csd) {
        if (err) { return reject(err) }
        const doc = new Dom({
          errorHandler: {
            error: errorHandler,
            fatalError: errorHandler
          }
        }).parseFromString(csd)
        const nodes = getEntityIDNodes('facility', doc)
        if (nodes.length > 1) {
          return reject(new Error('Multiple facilities returned when querying by other ID'))
        } else if (nodes.length < 1) {
          map.set(orgUnitId, null)
          return resolve()
        } else {
          map.set(orgUnitId, nodes[0].value)
          return resolve()
        }
      })
    })
    promises.push(promise)
  })

  Promise.all(promises).then(function () {
    callback(null, map)
  }, function (err) {
    callback(err)
  })
}

/**
 * Replaces the id in the adx document that is given using the provided mappings.
 * @param {Map} map - the map of the original ID (key) to the ID to update the
 * ADX message (value) with
 * @param {string} adx - the ADX message
 * @return {string} - the new ADX document
 */
function replaceMappedIds (map, adx) {
  const doc = new Dom().parseFromString(adx)
  const select = xpath.useNamespaces({'adx': 'urn:ihe:qrph:adx:2015'})
  map.forEach((efid, localId) => {
    if (efid === null) {
      // ignore this mapping
      return
    }
    const nodes = select(`//adx:adx/adx:group[@orgUnit='${localId}']/@orgUnit`, doc)
    nodes.forEach(function (node) {
      node.value = efid
    })
  })
  return new Ser().serializeToString(doc)
}

/**
 * mediatorResponse - factory function for creating a mediator response object.
 *
 * @return {Object} the created mediator response object
 */
const mediatorResponse = (urn) => {
  return {
    'x-mediator-urn': urn,
    'status': 'Successful',
    'response': {},
    'orchestrations': []
  }
}

/**
 * doUpstreamRequest - forward the original request upstream with a new ADX message
 *
 * @param  {http.IncomingMessage} inReq   the incoming request
 * @param  {http.ServerResponse}  outRes  the outgoing response to be sent back to the original client
 * @param  {string}               newAdx  the new ADX message to forward
 */
function doUpstreamRequest (inReq, outRes, newAdx, medRes) {
  let options = {
    hostname: config.upstream.host,
    port: config.upstream.port,
    path: inReq.url,
    method: inReq.method,
    headers: {
      'Content-Type': 'application/xml'
    }
  }

  console.log('Making upstream request...')
  // Make upstream request
  let outReq = http.request(options, (inRes) => {
    outRes.writeHead(inRes.statusCode, { 'Content-Type': 'application/json+openhim' })

    // determine overall status
    if (inRes.statusCode >= 200 && inRes.statusCode < 300) {
      medRes.status = 'Successful'
    } else {
      medRes.status = 'Failed'
    }

    let body = ''
    inRes.on('data', (chunk) => {
      body += chunk.toString()
    })

    inRes.on('end', () => {
      medRes.response.status = inRes.statusCode
      medRes.response.headers = inRes.headers
      medRes.response.body = body
      medRes.response.timestamp = new Date()

      outRes.end(JSON.stringify(medRes))
    })
  })

  outReq.on('error', (err) => {
    console.error('Error connecting to upstream server', err.stack)

    medRes.status = 'Failed'
    medRes.response.body = err.message
    medRes.response.timestamp = new Date()
    medRes.response.status = 500

    outRes.writeHead(medRes.response.status, { 'Content-Type': 'application/json+openhim' })
    outRes.end(JSON.stringify(medRes))
    return
  })

  outReq.end(newAdx)
}

/**
 * verifyIDs - verifies each ID exists in the InfoManager
 *
 * @param  {Array} orgUnits an array of each orgUnit as a string
 * @return {Promise}        a Promise that will resolve when all IDs have been verified, otherwise it will reject on error
 */
function verifyIDs (orgUnits) {
  const promises = []
  orgUnits.forEach((orgUnit) => {
    promises.push(new Promise((resolve, reject) => {
      fetchFacility(orgUnit, (err, csd) => {
        if (err) {
          err.statusCode = 500
          reject(err)
        }
        const errorHandler = (err) => {
          err = new Error(err)
          err.statusCode = 500
          console.log('Failed to parse returned CSD document' + err.stack)
          reject(err)
        }
        const doc = new Dom({
          errorHandler: {
            error: errorHandler,
            fatalError: errorHandler
          }
        }).parseFromString(csd)
        const nodes = getEntityIDNodes('facility', doc)
        if (nodes.length < 1) {
          const err = new Error("A code that couldn't be verified in the InfoManager was discovered.")
          err.statusCode = 400
          reject(err)
        } else {
          resolve()
        }
      })
    }))
  })
  return Promise.all(promises)
}

/**
 * setupServer - configures the http server for this mediator
 *
 * @return {http.Server}  the configured http server
 */
function setupServer () {
  let server = http.createServer((inReq, outRes) => {
    let adx = ''
    inReq.on('data', function (chunk) {
      adx += chunk.toString()
    })

    // construct initial mediator response object
    const medRes = mediatorResponse(mediatorConfig.urn)

    inReq.on('end', function () {
      console.log('Processing recieved ADX message...')
      // transform and write to outReq
      // 1. Extract an array of unique orgUnit Ids
      let orgUnits = extractOrgUnitIds(adx)
      console.log('Found the following orgUnits:')
      console.log(orgUnits)

      if (config.verifyOnly) {
        // 2. Verify each orgUnit ID
        verifyIDs(orgUnits).then(() => {
          // on fulfilled
          // Finally
          doUpstreamRequest(inReq, outRes, adx, medRes)
        }, (err) => {
          // on rejected
          console.log('Failed to verify IDs:', err.stack)

          medRes.status = 'Failed'
          medRes.response.body = err.message
          medRes.response.timestamp = new Date()
          medRes.response.status = err.statusCode

          outRes.writeHead(medRes.response.status, { 'Content-Type': 'application/json+openhim' })
          outRes.end(JSON.stringify(medRes))
          return
        })
      } else {
        // 2. Lookup the enterprise orgUnit Id for each local orgUnit Id, return a
        // map
        fetchMap(orgUnits, function (err, map) {
          if (err) {
            console.log('Failed to fetch a mappings:', err.stack)

            medRes.status = 'Failed'
            medRes.response.body = err.message
            medRes.response.timestamp = new Date()
            medRes.response.status = 500

            outRes.writeHead(medRes.response.status, { 'Content-Type': 'application/json+openhim' })
            outRes.end(JSON.stringify(medRes))
            return
          }
          console.log('Looked up mappings in InfoManager:')
          console.log(map)
          // 3. replace each mapped item in the original adx document
          let newAdx = replaceMappedIds(map, adx)
          console.log('Transformed ADX message.')

          // Finally
          doUpstreamRequest(inReq, outRes, newAdx, medRes)
        })
      }
    })
  })

  return server
}

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start (callback) {
  if (apiConf.register) {
    utils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        console.log('Failed to register this mediator, check your config')
        console.log(err.stack)
        process.exit(1)
      }
      apiConf.api.urn = mediatorConfig.urn
      utils.fetchConfig(apiConf.api, (err, newConfig) => {
        console.log('Received initial config:')
        console.log(JSON.stringify(newConfig))
        config = newConfig
        if (err) {
          console.log('Failed to fetch initial config')
          console.log(err.stack)
          process.exit(1)
        } else {
          console.log('Successfully registered mediator!')
          let server = setupServer()
          server.listen(8533, () => {
            let configEmitter = utils.activateHeartbeat(apiConf.api)
            configEmitter.on('config', (newConfig) => {
              console.log('Received updated config:')
              console.log(JSON.stringify(newConfig))
              config = newConfig
            })
            callback(server)
          })
        }
      })
    })
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config
    let server = setupServer()
    server.listen(8533, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => console.log('Listening on 8533...'))
}
