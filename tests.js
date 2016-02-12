'use strict';

const fs = require('fs');
const http = require('http');
const tap = require('tap');
const rewire = require('rewire');
const spawn = require('child_process').spawn;

const index = rewire('./index.js');
const extractOrgUnitIds = index.__get__('extractOrgUnitIds');
const fetchFacility = index.__get__('fetchFacility');
const fetchMap = index.__get__('fetchMap');
const replaceMappedIds = index.__get__('replaceMappedIds');
const verifyIDs = index.__get__('verifyIDs');

let config = index.__get__('config');
config.infoman = {
  path: '/CSD/csr/datim-small/careServicesRequest/urn:ihe:iti:csd:2014:stored-function:facility-search',
  port: 8984,
  host: 'localhost'
};

function spawnCsdServer() {
  var csdServer = spawn('./test-csd-server.js');
  csdServer.stdout.on('data', (data) => {
    console.log(`CSD Server: ${data}`);
  });
  return csdServer;
}

function spawnDhisServer() {
  var dhisServer = spawn('./test-dhis-server.js');
  dhisServer.stdout.on('data', (data) => {
    console.log(`DHIS Server: ${data}`);
  });
  return dhisServer;
}

function spawnOpenHIMServer() {
  var ohmServer = spawn('./test-openhim-server.js');
  ohmServer.stdout.on('data', (data) => {
    console.log(`OpenHIM Server: ${data}`);
  });
  return ohmServer;
}

function spawnMediatorServer(stdoutListenser) {
  var medServer = spawn('./index.js', { env: { 'NODE_TLS_REJECT_UNAUTHORIZED': '0' } });
  if (!stdoutListenser) {
    medServer.stdout.on('data', (data) => {
      console.log(`Mediator Server: ${data}`);
    });
  } else {
    medServer.stdout.on('data', stdoutListenser);
  }
  return medServer;
}

tap.test('.extractOrgUnitIds', function (t) {
  let orgUnits = extractOrgUnitIds(fs.readFileSync('pulled_from_node.xml').toString());
  t.equals(orgUnits.size, 2);
  t.ok(orgUnits.has('p.ao.pepfar.44'));
  t.ok(orgUnits.has('p.ao.pepfar.3'));
  t.end();
});

tap.test('.fetchFacility - should fetch a facility that exists', function (t) {
  var csdServer = spawnCsdServer();
  setTimeout(function () {
    fetchFacility('p.ao.pepfar.3', function (err, csd) {
      t.error(err);
      t.match(csd, 'facility entityID=');
      csdServer.kill();
      t.end();
    });
  }, 500);
});

tap.test('.fetchFacility - should return an error if it cant connect to the CSD server', function (t) {
  fetchFacility('p.ao.pepfar.3', function (err, csd) {
    t.ok(err);
    t.notOk(csd);
    t.end();
  });
});

tap.test('.fetchMap - should create a correct mapping', function (t) {
  var csdServer = spawnCsdServer();
  setTimeout(function () {
    fetchMap(['p.ao.pepfar.44', 'p.ao.pepfar.3'], function (err, map) {
      t.equals(map.get('p.ao.pepfar.44'), '123');
      t.equals(map.get('p.ao.pepfar.3'), '456');
      csdServer.kill();
      t.end();
    });
  }, 500);
});

tap.test('.fetchMap - should return an error when multiple facilities are found in a response', function (t) {
  var csdServer = spawnCsdServer();
  setTimeout(function () {
    fetchMap(['p.ao.pepfar.44', 'multi'], function (err, map) {
      t.ok(err);
      t.notOk(map);
      csdServer.kill();
      t.end();
    });
  }, 500);
});

tap.test('.fetchMap - should return an error when bad xml is returned', function (t) {
  var csdServer = spawnCsdServer();
  setTimeout(function () {
    fetchMap(['p.ao.pepfar.44', 'bad-xml'], function (err, map) {
      t.ok(err);
      t.notOk(map);
      csdServer.kill();
      t.end();
    });
  }, 500);
});

tap.test('.fetchMap - should return an error when fetchFacility fails', function (t) {
  const undo = index.__set__('fetchFacility', function (orgUnitId, callback) {
    callback(new Error('Im a failure! :('));
  });
  fetchMap(['p.ao.pepfar.44', 'p.ao.pepfar.3'], function (err, map) {
    t.ok(err);
    t.notOk(map);
    undo();
    t.end();
  });
});

tap.test('.replaceMappedIds', function (t) {
  let map = new Map();
  map.set('p.ao.pepfar.44', '123');
  map.set('p.ao.pepfar.3', '456');
  let newAdx = replaceMappedIds(map, fs.readFileSync('pulled_from_node.xml').toString());
  t.match(newAdx, 'orgUnit="123"');
  t.match(newAdx, 'orgUnit="456"');
  t.end();
});

tap.test('.verifyIDs - should resolve on valid IDs', function (t) {
  var csdServer = spawnCsdServer();
  setTimeout(function () {
    const promise = verifyIDs(['p.ao.pepfar.44', 'p.ao.pepfar.3']);
    promise.then(function () {
      csdServer.kill();
      t.pass('promise resolved');
      t.end();
    });
  }, 500);
});

tap.test('.verifyIDs - should reject on invalid IDs', function (t) {
  var csdServer = spawnCsdServer();
  setTimeout(function () {
    const promise = verifyIDs(['p.ao.pepfar.44', 'wat']);
    promise.then(function () {}, function (err) {
      csdServer.kill();
      t.equal(err.statusCode, 400);
      t.end();
    });
  }, 500);
});

tap.test('.verifyIDs - should reject when cannot fetchFacility', function (t) {
  const undo = index.__set__('fetchFacility', function (orgUnitId, callback) {
    callback(new Error('Im a failure! :('));
  });
  const promise = verifyIDs(['p.ao.pepfar.3', 'p.ao.pepfar.44']);
  promise.then(function () {}, function (err) {
    undo();
    t.equal(err.statusCode, 500);
    t.end();
  });
});

tap.test('.verifyIDs - should reject when bad xml is recieved', function (t) {
  var csdServer = spawnCsdServer();
  setTimeout(function () {
    const promise = verifyIDs(['p.ao.pepfar.44', 'bad-xml']);
    promise.then(function () {}, function (err) {
      csdServer.kill();
      t.equal(err.statusCode, 500);
      t.end();
    });
  }, 500);
});

tap.test('Integration test - success case', function (t) {
  var csdServer = spawnCsdServer();
  var dhisServer = spawnDhisServer();
  setTimeout(function () {
    require('./config/config').register = false;
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      };
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'CORRECT CODES USED');
          csdServer.kill();
          dhisServer.kill();
          server.close();
          t.end();
        });
      });
      req.end(fs.readFileSync('pulled_from_node.xml'));
    });
  }, 500);
});

tap.test('Integration test - should return a mediator response', function (t) {
  var csdServer = spawnCsdServer();
  var dhisServer = spawnDhisServer();
  setTimeout(function () {
    require('./config/config').register = false;
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      };
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          const medRes = JSON.parse(chunk.toString());
          console.log(medRes.urn);
          t.equals(medRes['x-mediator-urn'], 'urn:uuid:70508e92-3637-4344-9a47-d46b9b373fb4', 'should have correct mediator urn');
          t.ok(medRes.response, 'should have a response object');
          t.ok(medRes.response.status, 'should have a response status');
          t.ok(medRes.response.body, 'should have a response body');
          t.ok(medRes.response.timestamp, 'should have a response timestamp');
          csdServer.kill();
          dhisServer.kill();
          server.close();
          t.end();
        });
      });
      req.end(fs.readFileSync('pulled_from_node.xml'));
    });
  }, 500);
});

tap.test('Integration test - success case, spawned as a mediator process', function (t) {
  var csdServer = spawnCsdServer();
  var dhisServer = spawnDhisServer();
  var ohmServer = spawnOpenHIMServer();
  setTimeout(function () {
    var medServer = spawnMediatorServer();
    setTimeout(function () {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      };
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'CORRECT CODES USED');
          csdServer.kill();
          dhisServer.kill();
          medServer.kill();
          ohmServer.kill();
          t.end();
        });
      });
      req.end(fs.readFileSync('pulled_from_node.xml'));
    }, 1000);
  }, 1000);
});

tap.test('Integration test - failure case, codes not found', function (t) {
  var csdServer = spawnCsdServer();
  var dhisServer = spawnDhisServer();
  setTimeout(function () {
    require('./config/config').register = false;
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      };
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'INCORRECT CODES USED');
          csdServer.kill();
          dhisServer.kill();
          server.close();
          t.end();
        });
      });
      req.end(fs.readFileSync('pulled_from_node_incorrect_codes.xml'));
    });
  }, 500);
});

tap.test('Integration test - failure case, fetchMap return an error', function (t) {
  const undo = index.__set__('fetchMap', function (orgUnits, callback) {
    callback(new Error('Im a failure! :('));
  });
  var csdServer = spawnCsdServer();
  var dhisServer = spawnDhisServer();
  setTimeout(function () {
    require('./config/config').register = false;
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      };
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'Im a failure! :(');
          t.equals(res.statusCode, 500);
          csdServer.kill();
          dhisServer.kill();
          server.close();
          undo();
          t.end();
        });
      });
      req.end(fs.readFileSync('pulled_from_node_incorrect_codes.xml'));
    });
  }, 500);
});

tap.test('Integration test - failure case, spawned as a mediator process but cant register', function (t) {
  let call = 0;
  var medServer = spawnMediatorServer(function (data) {
    if (call === 0) {
      t.match(data.toString(), 'Failed to register this mediator, check your config');
      medServer.kill();
      t.end();
      call++;
    }
  });
});

tap.test('Integration test - verify only success case', function (t) {
  var csdServer = spawnCsdServer();
  var dhisServer = spawnDhisServer();
  setTimeout(function () {
    require('./config/config').register = false;
    require('./config/mediator').config.verifyOnly = true;
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      };
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'ORIGINAL CODES USED');
          csdServer.kill();
          dhisServer.kill();
          server.close();
          t.end();
        });
      });
      req.end(fs.readFileSync('pulled_from_node.xml'));
    });
  }, 500);
});

tap.test('Integration test - verify only failure case, verifyIDs fails', function (t) {
  const undo = index.__set__('verifyIDs', function () {
    return new Promise(function (resolve, reject) {
      const err = new Error('Im a (verify) failure! :(');
      err.statusCode = 500;
      reject(err);
    });
  });
  var csdServer = spawnCsdServer();
  var dhisServer = spawnDhisServer();
  setTimeout(function () {
    require('./config/config').register = false;
    require('./config/mediator').config.verifyOnly = true;
    index.start((server) => {
      let options = {
        host: 'localhost',
        port: 8533,
        method: 'POST'
      };
      const req = http.request(options, function (res) {
        res.on('data', function (chunk) {
          t.equals(JSON.parse(chunk.toString()).response.body, 'Im a (verify) failure! :(');
          t.equals(res.statusCode, 500);
          undo();
          csdServer.kill();
          dhisServer.kill();
          server.close();
          t.end();
        });
      });
      req.end(fs.readFileSync('pulled_from_node.xml'));
    });
  }, 500);
});
