'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { test } = require('node:test')

const { createComposerService, createGraphqlServices, graphqlRequest } = require('./helper')

const { compose } = require('../lib')

test('should run a query to a single subgraph without entities', async t => {
  const query = '{ artists (where: { id: { in: ["103","102"] } }) { lastName } }'
  const expectedResult = { artists: [{ lastName: 'Benigni' }, { lastName: 'Molko' }] }

  const services = await createGraphqlServices(t, [{
    name: 'artists-subgraph',
    file: path.join(__dirname, 'fixtures/artists.js'),
    listen: true
  }])
  const options = {
    subgraphs: services.map(service => ({
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

// test('should run a query multiple subgraphs without entities')

// test('should run a query a single subgraph with entities')

// test('should run a query multiple subgraphs with entities')

// test('should run a query multiple subgraphs with entities and entities resolvers on composer')
