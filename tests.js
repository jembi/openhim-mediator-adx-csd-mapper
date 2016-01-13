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

tap.test('.extractOrgUnitIds', function (t) {
  let orgUnits = extractOrgUnitIds(fs.readFileSync('pulled_from_node.xml').toString());
  t.equals(orgUnits.size, 2);
  t.ok(orgUnits.has('p.ao.pepfar.44'));
  t.ok(orgUnits.has('p.ao.pepfar.3'));
  t.end();
});

tap.test('.fetchFacility', function (t) {
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

tap.test('.fetchMap', function (t) {
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

tap.test('.replaceMappedIds', function (t) {
  let map = new Map();
  map.set('p.ao.pepfar.44', '123');
  map.set('p.ao.pepfar.3', '456');
  let newAdx = replaceMappedIds(map, fs.readFileSync('pulled_from_node.xml').toString());
  t.match(newAdx, 'orgUnit="123"');
  t.match(newAdx, 'orgUnit="456"');
  t.end();
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
          t.equals(chunk.toString(), 'CORRECT CODES USED');
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
