#!/usr/bin/env node
'use strict';

const http = require('http');

const sucessfulResponse = 'CORRECT CODES USED';
const failedResponse = 'INCORRECT CODES USED';
const failedResponse2 = 'ORIGINAL CODES USED';

const server = http.createServer(function (req, res) {
  let body = '';
  req.on('data', function (chunk) {
    body += chunk.toString();
  });
  req.on('end', function () {
    console.log(`Recieved ${req.method} request to ${req.url}`);
    console.log(`with body: ${body}`);
    if (body.indexOf('orgUnit="123"') > 0 && body.indexOf('orgUnit="456"') > 0) {
      res.writeHead(200);
      res.end(sucessfulResponse);
    } else if (body.indexOf('orgUnit="p.ao.pepfar.3"') > 0 && body.indexOf('orgUnit="p.ao.pepfar.44"') > 0) {
      res.writeHead(200);
      res.end(failedResponse2);
    } else {
      res.writeHead(400);
      res.end(failedResponse);
    }
  });
});

server.listen(9999, function () {
  console.log('Mock server listening on 9999');
});
