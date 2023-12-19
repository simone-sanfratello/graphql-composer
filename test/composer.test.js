'use strict'

const assert = require('node:assert')
const path = require('node:path')
const { test } = require('node:test')
const dedent = require('dedent')
const { createGraphqlServices } = require('./helper')
const { Composer } = require('../lib/composer')

test('should compose a single subgraph without entities', { skip: true }, async t => {
  const expectedSdl = dedent`input WhereConditionIn {
      in: [ID!]!
    }

    input ArtistsWhereCondition {
      id: WhereConditionIn
    }

    type Artist {
      id: ID
      firstName: String
      lastName: String
      profession: String
    }

    type Query {
      artists(where: ArtistsWhereCondition): [Artist]
    }`

  const services = await createGraphqlServices(t, [{
    name: 'artists-subgraph',
    file: path.join(__dirname, 'fixtures/artists.js'),
    listen: true
  }])

  const options = {
    subgraphs: services.map(service => (
      {
        name: service.name,
        server: { host: service.host }
      }
    ))
  }

  const composer = new Composer(options)
  await composer.compose()

  assert.strictEqual(composer.toSdl(), expectedSdl)
})

test('should compose multiple subgraphs without entities', async t => {
  const expectedSdl = dedent`input WhereConditionIn {
      in: [ID!]!
    }
    
    input ArtistsWhereCondition {
      id: WhereConditionIn
    }
    
    type Artist {
      id: ID
      firstName: String
      lastName: String
      profession: String
    }
    
    type Query {
      artists(where: ArtistsWhereCondition): [Artist]
      foods(where: FoodsWhereCondition): [Food]
    }
    
    input FoodsWhereCondition {
      id: WhereConditionIn
    }
    
    type Food {
      id: ID!
      name: String
    }`

  const services = await createGraphqlServices(t, [
    {
      name: 'artists-subgraph',
      file: path.join(__dirname, 'fixtures/artists.js'),
      listen: true
    },
    {
      name: 'foods-subgraph',
      file: path.join(__dirname, 'fixtures/foods.js'),
      listen: true
    }
  ])

  const options = {
    subgraphs: services.map(service => (
      {
        name: service.name,
        server: { host: service.host }
      }
    ))
  }

  const composer = new Composer(options)
  await composer.compose()

  assert.strictEqual(composer.toSdl(), expectedSdl)
})

// test('should compose a single subgraph with entities')

// test('should compose multiple subgraphs with entities and entities resolvers on composer')
