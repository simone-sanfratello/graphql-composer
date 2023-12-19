'use strict'
const { strictEqual } = require('node:assert')
const Fastify = require('fastify')
const { getIntrospectionQuery } = require('graphql')
const Mercurius = require('mercurius')
const { compose } = require('../lib')
const assert = require('node:assert')

const introspectionQuery = getIntrospectionQuery()

async function buildComposer (t, subgraphs, options) {
  const promises = subgraphs.map(async (subgraph) => {
    // TODO subgraph.file
    delete require.cache[require.resolve(subgraph.file)]
    const {
      name,
      resolvers,
      schema
    } = require(subgraph.file)
    const server = Fastify()
    t.after(async () => { try { await server.close() } catch { } })

    server.register(Mercurius, { schema, resolvers, graphiql: true })
    server.get('/.well-known/graphql-composition', async function (req, reply) {
      return reply.graphql(getIntrospectionQuery())
    })

    return {
      name,
      entities: options.entities[subgraph],
      server: {
        host: await server.listen(),
        composeEndpoint: '/.well-known/graphql-composition',
        graphqlEndpoint: '/graphql'
      }
    }
  })

  const composerOptions = {
    ...options,
    subgraphs: await Promise.all(promises)
  }
  const composer = await compose(composerOptions)
  const service = Fastify()
  t.after(async () => { try { await service.close() } catch { } })

  service.register(Mercurius, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers,
    graphiql: true
  })

  return { composer, service }
}

async function graphqlRequest (app, query, variables) {
  const response = await app.inject({
    path: '/graphql',
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })

  const { data, errors } = response.json()

  if (errors) {
    throw errors
  }

  strictEqual(response.statusCode, 200)

  return data
}

async function createGraphqlServiceFromFile (t, { file, fastify, exposeIntrospection = {} }) {
  delete require.cache[require.resolve(file)]
  const config = require(file)

  const service = Fastify(fastify ?? { logger: false })
  service.register(Mercurius, { schema: config.schema, resolvers: config.resolvers })

  if (exposeIntrospection) {
    service.get(exposeIntrospection.path || '/.well-known/graphql-composition', async function (req, reply) {
      return reply.graphql(introspectionQuery)
    })
  }

  t.after(async () => {
    try { await service.close() } catch { }
  })

  return { service, config }
}

async function createGraphqlServiceFromConfig (t, { fastify, mercurius, exposeIntrospection = {} }) {
  const service = Fastify(fastify ?? { logger: false })

  service.register(Mercurius, mercurius)

  if (exposeIntrospection) {
    service.get(exposeIntrospection.path || '/.well-known/graphql-composition', async function (req, reply) {
      return reply.graphql(introspectionQuery)
    })
  }

  t.after(async () => {
    try { await service.close() } catch { }
  })

  return service
}

async function createGraphqlServices (t, servicesConfig) {
  const services = []
  for (const config of servicesConfig) {
    let service
    if (config.file) {
      const s = await createGraphqlServiceFromFile(t, config)
      service = s.service
      config.reset = s.config.reset
      config.data = s.config.data
    } else if (config.mercurius) {
      service = await createGraphqlServiceFromConfig(t, config)
    }
    const s = { name: config.name, config, service }
    if (config.listen) {
      s.host = await service.listen()
    }
    services.push(s)
  }

  return services
}

function assertObject (actual, expected) {
  for (const k of Object.keys(expected)) {
    if (typeof expected[k] === 'function' && typeof actual[k] === 'function') { continue }
    if (typeof expected === 'object') {
      assertObject(actual[k], expected[k])
      continue
    }
    assert.deepStrictEqual(actual[k], expected[k])
  }
}

module.exports = { graphqlRequest, buildComposer, createGraphqlServices, assertObject }
