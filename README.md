[![Build Status](https://travis-ci.org/jembi/openhim-mediator-adx-csd-mapper.svg)](https://travis-ci.org/jembi/openhim-mediator-adx-csd-mapper) [![codecov.io](https://codecov.io/github/jembi/openhim-mediator-adx-csd-mapper/coverage.svg?branch=master)](https://codecov.io/github/jembi/openhim-mediator-adx-csd-mapper?branch=master)

ADX Mapper using CSD
====================

Maps orgUnits in an ADX message to an alternate ID looked up in a CSD InfoManager.

Run using `npm start`

You must configure the OpenHIM server details in `config/config.json`. Once the
mediator is running it may be configured via the OpenHIM console. If you are using
a self signed certificate for the OpenHIM you may have to run with
`NODE_TLS_REJECT_UNAUTHORIZED=0 npm start`.

Test using `npm test`
