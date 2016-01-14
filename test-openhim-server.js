#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');

const options = {
  key: fs.readFileSync('openhim-test-tls/key.pem'),
  cert: fs.readFileSync('openhim-test-tls/cert.pem')
};

const config = {
  infoman: {
    path: '/CSD/csr/datim-small/careServicesRequest/urn:ihe:iti:csd:2014:stored-function:facility-search',
    port: 8984,
    host: 'localhost'
  },
  'upstream': {
    port: 9999,
    host: 'localhost'
  }
};

const auth = {
  salt: 'xxx',
  ts: 'xxx'
};

const server = https.createServer(options, function (req, res) {
  let body = '';
  req.on('data', function (chunk) {
    body += chunk.toString();
  });
  req.on('end', function () {
    console.log(`Recieved ${req.method} request to ${req.url}`);
    console.log(`with body: ${body}`);
    if (req.url === '/authenticate/root@openhim.org') {
      res.writeHead(200);
      res.end(JSON.stringify(auth));
    } else if (req.url === '/mediators') {
      res.writeHead(201);
      res.end();
    } else if (req.url === '/mediators/urn:uuid:70508e92-3637-4344-9a47-d46b9b373fb4/heartbeat') {
      res.writeHead(200);
      res.end(JSON.stringify(config));
    }
  });
});

server.listen(8080, function () {
  console.log('Mock server listening on 8080');
});
