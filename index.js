#!/usr/bin/env node
'use strict';

const dom = require('xmldom').DOMParser;
const ser = require('xmldom').XMLSerializer;
const http = require('http');
const utils = require('openhim-mediator-utils');
const xpath = require('xpath');

// Config
var config = {}; // this will vary depending on whats set in openhim-core
const apiConf = require('./config/config');
const mediatorConfig = require('./config/mediator');

/**
 * Extracts the orgUnits from an ADX message
 * @param {string} adx - the adx message to extract from
 * @param {function} callback - a callback(err, orgUnits) that gets called with an error object if an error occurs and orgUnits which is a Set of orgUnit ID string.
 */
function extractOrgUnitIds(adx) {
  const doc = new dom().parseFromString(adx);
  const select = xpath.useNamespaces({'adx': 'urn:ihe:qrph:adx:2015'});
  const nodes = select('//adx:adx/adx:group/@orgUnit', doc);
  let orgUnits = new Set();
  nodes.forEach(function (node) {
    orgUnits.add(node.value);
  });
  return orgUnits;
}

/**
 * Fetches a single facility from the InfoMan by otherId, the response is sent to the callback as a full CSD XML response.
 * @param {string} orgUnitId - the ID of the facility that you wish to fetch
 * @param {Function} callback - the node style callback to call
 */
function fetchFacility(orgUnitId, callback) {
  
  var options = {
    hostname: config.infoman.host,
    port: config.infoman.port,
    path: config.infoman.path,
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml'
    }
  };
  
  let req = http.request(options, function (res) {
    let body = '';
    res.on('data', function (chunk) {
      body += chunk.toString();
    });
    res.on('end', function () {
      callback(null, body);
    });
  });
  
  req.on('error', function (err) {
    callback(err);
  });
              
  let body = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                <csd:otherID>${orgUnitId}</csd:otherID>
              </csd:requestParams>`;
  
  req.write(body);
  req.end();
}

/**
 * Fetches a map of local IDs to enterprise IDs from the InfoMan
 * @param {Array} orgUnits - An array of orgUnits IDs as strings
 * @param {Function} callback - A calllback that will be called with an error object if an error occurs and a map with each map element containing the orgUnitId as a key and the corresponding enterprise ID as a value.
 */
function fetchMap(orgUnits, callback) {
  let map = new Map();
  const promises = [];
  orgUnits.forEach(function (orgUnitId) {
    const promise = new Promise(function (resolve, reject) {
      fetchFacility(orgUnitId, function (err, csd) {
        if (err) { reject(err); }
        try {
          const doc = new dom().parseFromString(csd);
          const select = xpath.useNamespaces({'csd': 'urn:ihe:iti:csd:2013'});
          const nodes = select('//csd:CSD/csd:facilityDirectory/csd:facility/@entityID', doc);
          if (nodes.length > 1) {
            return reject(new Error('Multiple facilities returned when querying by other ID'));
          }
          map.set(orgUnitId, nodes[0].value);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
    promises.push(promise);
  });
  
  Promise.all(promises).then(function () {
    callback(null, map);
  }, function (err) {
    callback(err);
  });
}

/**
 * Replaces the id in the adx document that is given using the provided mappings.
 * @param {Map} map - the map of the original ID (key) to the ID to update the ADX message (value) with
 * @param {string} adx - the ADX message
 * @return {string} - the new ADX document 
 */
function replaceMappedIds(map, adx) {
  const doc = new dom().parseFromString(adx);
  const select = xpath.useNamespaces({'adx': 'urn:ihe:qrph:adx:2015'});
  map.forEach((efid, localId) => {
    const nodes = select(`//adx:adx/adx:group[@orgUnit='${localId}']/@orgUnit`, doc);
    nodes.forEach(function (node) {
      node.value = efid;
    });
  });
  return new ser().serializeToString(doc);
}

/**
 * setupServer - configures the http server for this mediator
 *  
 * @return {http.Server}  the configured http server 
 */ 
function setupServer() {
  let server = http.createServer((inReq, outRes) => {
    let options = {
      hostname: config.upstream.host,
      port: config.upstream.port,
      path: inReq.url,
      method: inReq.method,
      headers: {
        'Content-Type': 'application/xml'
      }
    };

    let adx = '';
    inReq.on('data', function(chunk) {
      adx += chunk.toString();
    });
    
    inReq.on('end', function () {
      console.log('Processing recieved ADX message...');
      // transform and write to outReq
      // 1. Extract an array of unique orgUnit Ids
      let orgUnits = extractOrgUnitIds(adx);
      console.log('Found the following orgUnits:');
      console.log(orgUnits);
      // 2. Lookup the enterprise orgUnit Id for each local orgUnit Id, return a map
      fetchMap(orgUnits, function (err, map) {
        console.log('Looked up mappings in InfoManager:');
        console.log(map);
        // 3. replace each mapped item in the original adx document
        let newAdx = replaceMappedIds(map, adx);
        console.log('Transformed ADX message.');
        
        console.log('Making upstream request...');
        // Make upstream request
        let outReq = http.request(options, (inRes) => {
          outRes.writeHead(inRes.statusCode, inRes.headers);
          console.log('Piping upstream response back to original sender.');
          inRes.pipe(outRes);
        });
        
        outReq.end(newAdx);
      });
    });
    
  });

  return server;
}


/**
 * start - starts the mediator
 *  
 * @param  {Function} callback a node style callback that is called once the server is started 
 */ 
function start(callback) {
  if (apiConf.register) {
    utils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        console.log('Failed to register this mediator, check your config');
        console.log(err.stack);
        process.exit(1);
      }
      apiConf.api.urn = mediatorConfig.urn;
      utils.fetchConfig(apiConf.api, (err, newConfig) => {
        console.log('Received initial config:');
        console.log(JSON.stringify(newConfig));
        config = newConfig;
        if (err) {
          console.log('Failed to fetch initial config');
          console.log(err.stack);
          process.exit(1);
        } else {
          console.log('Successfully registered mediator!');
          let server = setupServer();
          server.listen(8533, () => {
            let configEmitter = utils.activateHeartbeat(apiConf.api);
            configEmitter.on('config', (newConfig) => {
              console.log('Received updated config:');
              console.log(JSON.stringify(newConfig));
              config = newConfig;
            });
            callback(server);
          });
        }
      });
    });
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config;
    let server = setupServer();
    server.listen(8533, () => callback(server) );
  }
}
exports.start = start;

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => console.log('Listening on 8533...') );
}
