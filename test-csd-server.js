#!/usr/bin/env node
'use strict';

const http = require('http');

const response1 = `<CSD xmlns='urn:ihe:iti:csd:2013'>
                    <serviceDirectory/>
                    <organizationDirectory/>
                    <facilityDirectory>
                      <facility entityID='123'>
                        <!-- POTENTIALLY LARGE AMOUNT OF CONTENT ON THE FACILITY -->
                      </facility>
                    </facilityDirectory>
                    <providerDirectory/>
                  </CSD>`;
                  
const response2 = `<CSD xmlns='urn:ihe:iti:csd:2013'>
                    <serviceDirectory/>
                    <organizationDirectory/>
                    <facilityDirectory>
                      <facility entityID='456'>
                        <!-- POTENTIALLY LARGE AMOUNT OF CONTENT ON THE FACILITY -->
                      </facility>
                    </facilityDirectory>
                    <providerDirectory/>
                  </CSD>`;
                  
const response3 = `<CSD xmlns='urn:ihe:iti:csd:2013'>
                    <serviceDirectory/>
                    <organizationDirectory/>
                    <facilityDirectory/>
                    <providerDirectory/>
                  </CSD>`;
                  
const response4 = `<CSD xmlns='urn:ihe:iti:csd:2013'>
                    <serviceDirectory/>
                    <organizationDirectory/>
                    <facilityDirectory>
                      <facility entityID='456'>
                        <!-- POTENTIALLY LARGE AMOUNT OF CONTENT ON THE FACILITY -->
                      </facility>
                      <facility entityID='789'>
                        <!-- POTENTIALLY LARGE AMOUNT OF CONTENT ON THE FACILITY -->
                      </facility>
                    </facilityDirectory>
                    <providerDirectory/>
                  </CSD>`;
                  
const response5 = 'this<isnt<xml';

const server = http.createServer(function (req, res) {
  let body = '';
  req.on('data', function (chunk) {
    body += chunk.toString();
  });
  req.on('end', function () {
    console.log(`Recieved ${req.method} request to ${req.url}`);
    console.log(`with body: ${body}`);
    res.writeHead(200);
    if (body.indexOf('p.ao.pepfar.44') > 0) {
      res.end(response1);
    } else if (body.indexOf('p.ao.pepfar.3') > 0) {
      res.end(response2);
    } else if (body.indexOf('multi') > 0) {
      res.end(response4);
    }  else if (body.indexOf('bad-xml') > 0) {
      res.end(response5);
    } else {
      res.end(response3);
    }
  });
});

server.listen(8984, function () {
  console.log('Mock server listening on 8984');
});
