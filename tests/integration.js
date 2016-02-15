'use strict'

const fs = require('fs')
const http = require('http')
const tap = require('tap')
const rewire = require('rewire')
const spawn = require('child_process').spawn

const index = rewire('../index.js')

// don't log during tests - comment these out for debugging
console.log = () => {}
console.error = () => {}

let config = index.__get__('config')
config.infoman = {
  path: '/CSD/csr/datim-small/careServicesRequest/urn:ihe:iti:csd:2014:stored-function:facility-search',
  port: 8984,
  host: 'localhost',
  directory: 'facility'
}

function spawnCsdServer () {
  var csdServer = spawn('./tests/test-csd-server.js')
  csdServer.stdout.on('data', (data) => {
    console.log(`CSD Server: ${data}`)
  })
  return csdServer
}

function spawnDhisServer () {
  var dhisServer = spawn('./tests/test-dhis-server.js')
  dhisServer.stdout.on('data', (data) => {
    console.log(`DHIS Server: ${data}`)
  })
  return dhisServer
}

function spawnOpenHIMServer () {
  var ohmServer = spawn('./tests/test-openhim-server.js')
  ohmServer.stdout.on('data', (data) => {
    console.log(`OpenHIM Server: ${data}`)
  })
  return ohmServer
}

function spawnMediatorServer (stdoutListenser) {
  var medServer = spawn('./index.js', { env: { 'NODE_TLS_REJECT_UNAUTHORIZED': '0' } })
  if (!stdoutListenser) {
    medServer.stdout.on('data', (data) => {
      console.log(`Mediator Server: ${data}`)
    })
  } else {
    medServer.stdout.on('data', stdoutListenser)
  }
  return medServer
}

tap.test('Integration test - success case', function (t) {
  var csdServer = spawnCsdServer()
  var dhisServer = spawnDhisServer()
  setTimeout(function () {
    require('../config/config').register = false
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      }
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'CORRECT CODES USED')
          csdServer.kill()
          dhisServer.kill()
          server.close()
          t.end()
        })
      })
      req.end(fs.readFileSync('pulled_from_node.xml'))
    })
  }, 1000)
})

tap.test('Integration test - should return a mediator response', function (t) {
  var csdServer = spawnCsdServer()
  var dhisServer = spawnDhisServer()
  setTimeout(function () {
    require('../config/config').register = false
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      }
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          const medRes = JSON.parse(chunk.toString())
          console.log(medRes.urn)
          t.equals(medRes['x-mediator-urn'], 'urn:uuid:70508e92-3637-4344-9a47-d46b9b373fb4', 'should have correct mediator urn')
          t.ok(medRes.response, 'should have a response object')
          t.ok(medRes.response.status, 'should have a response status')
          t.ok(medRes.response.body, 'should have a response body')
          t.ok(medRes.response.timestamp, 'should have a response timestamp')
          csdServer.kill()
          dhisServer.kill()
          server.close()
          t.end()
        })
      })
      req.end(fs.readFileSync('pulled_from_node.xml'))
    })
  }, 1000)
})

tap.test('Integration test - success case, spawned as a mediator process', function (t) {
  var csdServer = spawnCsdServer()
  var dhisServer = spawnDhisServer()
  var ohmServer = spawnOpenHIMServer()
  setTimeout(function () {
    var medServer = spawnMediatorServer()
    setTimeout(function () {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      }
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'CORRECT CODES USED')
          csdServer.kill()
          dhisServer.kill()
          medServer.kill()
          ohmServer.kill()
          t.end()
        })
      })
      req.end(fs.readFileSync('pulled_from_node.xml'))
    }, 1500)
  }, 1000)
})

tap.test('Integration test - failure case, codes not found', function (t) {
  var csdServer = spawnCsdServer()
  var dhisServer = spawnDhisServer()
  setTimeout(function () {
    require('../config/config').register = false
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      }
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'INCORRECT CODES USED')
          csdServer.kill()
          dhisServer.kill()
          server.close()
          t.end()
        })
      })
      req.end(fs.readFileSync('pulled_from_node_incorrect_codes.xml'))
    })
  }, 1000)
})

tap.test('Integration test - failure case, fetchMap return an error', function (t) {
  const undo = index.__set__('fetchMap', function (orgUnits, callback) {
    callback(new Error('Im a failure! :('))
  })
  var csdServer = spawnCsdServer()
  var dhisServer = spawnDhisServer()
  setTimeout(function () {
    require('../config/config').register = false
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      }
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'Im a failure! :(')
          t.equals(res.statusCode, 500)
          csdServer.kill()
          dhisServer.kill()
          server.close()
          undo()
          t.end()
        })
      })
      req.end(fs.readFileSync('pulled_from_node_incorrect_codes.xml'))
    })
  }, 1000)
})

tap.test('Integration test - failure case, spawned as a mediator process but cant register', function (t) {
  let call = 0
  var medServer = spawnMediatorServer(function (data) {
    if (call === 0) {
      t.match(data.toString(), 'Failed to register this mediator, check your config')
      medServer.kill()
      t.end()
      call++
    }
  })
})

tap.test('Integration test - verify only success case', function (t) {
  var csdServer = spawnCsdServer()
  var dhisServer = spawnDhisServer()
  setTimeout(function () {
    require('../config/config').register = false
    require('../config/mediator').config.verifyOnly = true
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      }
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'ORIGINAL CODES USED')
          csdServer.kill()
          dhisServer.kill()
          server.close()
          t.end()
        })
      })
      req.end(fs.readFileSync('pulled_from_node.xml'))
    })
  }, 1000)
})

tap.test('Integration test - verify only failure case, verifyIDs fails', function (t) {
  const undo = index.__set__('verifyIDs', function () {
    return new Promise(function (resolve, reject) {
      const err = new Error('Im a (verify) failure! :(')
      err.statusCode = 500
      reject(err)
    })
  })
  var csdServer = spawnCsdServer()
  var dhisServer = spawnDhisServer()
  setTimeout(function () {
    require('../config/config').register = false
    require('../config/mediator').config.verifyOnly = true
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      }
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'Im a (verify) failure! :(')
          t.equals(res.statusCode, 500)
          undo()
          csdServer.kill()
          dhisServer.kill()
          server.close()
          t.end()
        })
      })
      req.end(fs.readFileSync('pulled_from_node.xml'))
    })
  }, 1000)
})
