'use strict'

const fs = require('fs')
const tap = require('tap')
const rewire = require('rewire')
const spawn = require('child_process').spawn

const index = rewire('../index.js')
const extractOrgUnitIds = index.__get__('extractOrgUnitIds')
const fetchFacility = index.__get__('fetchFacility')
const fetchMap = index.__get__('fetchMap')
const replaceMappedIds = index.__get__('replaceMappedIds')
const verifyIDs = index.__get__('verifyIDs')

// don't log during tests - comment these out for debugging
console.log = () => {}
console.error = () => {}

let config = index.__get__('config')
config.infoman = {
  path: '/CSD/csr/datim-small/careServicesRequest/urn:ihe:iti:csd:2014:stored-function:facility-search',
  port: 8984,
  host: 'localhost'
}

function spawnCsdServer () {
  var csdServer = spawn('./tests/test-csd-server.js')
  csdServer.stdout.on('data', (data) => {
    console.log(`CSD Server: ${data}`)
  })
  return csdServer
}

tap.test('.extractOrgUnitIds', function (t) {
  let orgUnits = extractOrgUnitIds(fs.readFileSync('pulled_from_node.xml').toString())
  t.equals(orgUnits.size, 2)
  t.ok(orgUnits.has('p.ao.pepfar.44'))
  t.ok(orgUnits.has('p.ao.pepfar.3'))
  t.end()
})

tap.test('.fetchFacility - should fetch a facility that exists', function (t) {
  var csdServer = spawnCsdServer()
  setTimeout(function () {
    fetchFacility('p.ao.pepfar.3', function (err, csd) {
      t.error(err)
      t.match(csd, 'facility entityID=')
      csdServer.kill()
      t.end()
    })
  }, 1000)
})

tap.test('.fetchFacility - should return an error if it cant connect to the CSD server', function (t) {
  fetchFacility('p.ao.pepfar.3', function (err, csd) {
    t.ok(err)
    t.notOk(csd)
    t.end()
  })
})

tap.test('.fetchMap - should create a correct mapping', function (t) {
  var csdServer = spawnCsdServer()
  setTimeout(function () {
    fetchMap(['p.ao.pepfar.44', 'p.ao.pepfar.3'], function (err, map) {
      t.error(err)
      t.equals(map.get('p.ao.pepfar.44'), '123')
      t.equals(map.get('p.ao.pepfar.3'), '456')
      csdServer.kill()
      t.end()
    })
  }, 1000)
})

tap.test('.fetchMap - should return an error when multiple facilities are found in a response', function (t) {
  var csdServer = spawnCsdServer()
  setTimeout(function () {
    fetchMap(['p.ao.pepfar.44', 'multi'], function (err, map) {
      t.ok(err)
      t.notOk(map)
      csdServer.kill()
      t.end()
    })
  }, 1000)
})

tap.test('.fetchMap - should return an error when bad xml is returned', function (t) {
  var csdServer = spawnCsdServer()
  setTimeout(function () {
    fetchMap(['p.ao.pepfar.44', 'bad-xml'], function (err, map) {
      t.ok(err)
      t.notOk(map)
      csdServer.kill()
      t.end()
    })
  }, 1000)
})

tap.test('.fetchMap - should return an error when fetchFacility fails', function (t) {
  const undo = index.__set__('fetchFacility', function (orgUnitId, callback) {
    callback(new Error('Im a failure! :('))
  })
  fetchMap(['p.ao.pepfar.44', 'p.ao.pepfar.3'], function (err, map) {
    t.ok(err)
    t.notOk(map)
    undo()
    t.end()
  })
})

tap.test('.replaceMappedIds', function (t) {
  let map = new Map()
  map.set('p.ao.pepfar.44', '123')
  map.set('p.ao.pepfar.3', '456')
  let newAdx = replaceMappedIds(map, fs.readFileSync('pulled_from_node.xml').toString())
  t.match(newAdx, 'orgUnit="123"')
  t.match(newAdx, 'orgUnit="456"')
  t.end()
})

tap.test('.verifyIDs - should resolve on valid IDs', function (t) {
  var csdServer = spawnCsdServer()
  setTimeout(function () {
    const promise = verifyIDs(['p.ao.pepfar.44', 'p.ao.pepfar.3'])
    promise.then(function () {
      csdServer.kill()
      t.pass('promise resolved')
      t.end()
    })
  }, 1000)
})

tap.test('.verifyIDs - should reject on invalid IDs', function (t) {
  var csdServer = spawnCsdServer()
  setTimeout(function () {
    const promise = verifyIDs(['p.ao.pepfar.44', 'wat'])
    promise.then(function () {}, function (err) {
      csdServer.kill()
      t.equal(err.statusCode, 400)
      t.end()
    })
  }, 1000)
})

tap.test('.verifyIDs - should reject when cannot fetchFacility', function (t) {
  const undo = index.__set__('fetchFacility', function (orgUnitId, callback) {
    callback(new Error('Im a failure! :('))
  })
  const promise = verifyIDs(['p.ao.pepfar.3', 'p.ao.pepfar.44'])
  promise.then(function () {}, function (err) {
    undo()
    t.equal(err.statusCode, 500)
    t.end()
  })
})

tap.test('.verifyIDs - should reject when bad xml is recieved', function (t) {
  var csdServer = spawnCsdServer()
  setTimeout(function () {
    const promise = verifyIDs(['p.ao.pepfar.44', 'bad-xml'])
    promise.then(function () {}, function (err) {
      csdServer.kill()
      t.equal(err.statusCode, 500)
      t.end()
    })
  }, 1000)
})
