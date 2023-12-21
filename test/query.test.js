'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { test } = require('node:test')
const pino = require('pino')

const { createComposerService, createGraphqlServices, graphqlRequest } = require('./helper')
const { compose } = require('../lib')

test('should run a query to a single subgraph', async t => {
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

test('should run a query to a single subgraph, with a nested type', { skip: true }, async (t) => {
  const query = `
    query {
      list {
        id name { firstName lastName }
      }
    }
  `
  const expectedResult = { list: [{ id: '1', name: { firstName: 'Peter', lastName: 'Pluck' } }, { id: '2', name: { firstName: 'John', lastName: 'Writer' } }] }

  const services = await createGraphqlServices(t, [{
    name: 'authors-subgraph',
    file: path.join(__dirname, 'fixtures/authors.js'),
    listen: true
  }])
  const options = {
    logger: pino({ level: 'debug' }),
    subgraphs: services.map(service => ({
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

test('should run a query on multiple subgraphs', async t => {
  const query = '{ getBook(id: 1) { id, title, genre, rate } }'
  const expectedResult = { getBook: { id: '1', title: 'A Book About Things That Never Happened', genre: 'FICTION', rate: 3 } }

  const services = await createGraphqlServices(t, [
    {
      name: 'books-subgraph',
      file: path.join(__dirname, 'fixtures/books.js'),
      listen: true
    },
    {
      name: 'reviews-subgraph',
      file: path.join(__dirname, 'fixtures/reviews.js'),
      listen: true
    }
  ])
  const options = {
    logger: pino({ level: 'debug' }),
    subgraphs: services.map(service => ({
      entities: service.config.entities,
      name: service.name,
      server: { host: service.host }
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})

// test('should run a query with multiple results on multiple subgraphs', { only: true }, async t => {
// })

// test('should run a query a single subgraph with entities', async t => {
// })

// test('should run a query multiple subgraphs with entities', async t => {
// })

// test('should run a query multiple subgraphs with entities and entities resolvers on composer', async t => {
// })
