'use strict'
const metaline = require('metaline')
const { isObject, defaultOnError, dummyLogger, createDefaultArgsAdapter } = require('./utils')

const DEFAULT_COMPOSE_ENDPOINT = '/.well-known/graphql-composition'
const DEFAULT_GRAPHQL_ENDPOINT = '/graphql'

function validateArray (value, name, defaultValue) {
  if (!value && defaultValue) {
    return defaultValue
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`)
  }

  return value
}

function validateFunction (value, name, defaultValue) {
  if (!value && defaultValue) {
    return defaultValue
  }

  if (typeof value !== 'function') {
    throw new TypeError(`${name} must be a function`)
  }

  return value
}

function validateObject (value, name, defaultValue) {
  if (!value && defaultValue) {
    return defaultValue
  }

  if (!isObject(value)) {
    throw new TypeError(`${name} must be an object`)
  }

  return value
}

function validateString (value, name, defaultValue) {
  if (!value && defaultValue) {
    return defaultValue
  }

  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }

  return value
}

function validateComposerOptions (options) {
  validateObject(options, 'options')

  const validatedOptions = {
    logger: options.logger ?? dummyLogger(),
    queryTypeName: options.queryTypeName ?? 'Query',
    mutationTypeName: options.mutationTypeName ?? 'Mutation',
    onSubgraphError: options.onSubgraphError ?? defaultOnError,
    addEntitiesResolvers: Boolean(options.addEntitiesResolvers)
  }

  validateString(validatedOptions.queryTypeName, 'queryTypeName')
  validateString(validatedOptions.mutationTypeName, 'mutationTypeName')
  validateFunction(validatedOptions.onSubgraphError, 'onSubgraphError')

  validatedOptions.defaultArgsAdapter = validateDefaultArgsAdapterOptions(options.defaultArgsAdapter)

  validatedOptions.subgraphs = new Map()
  if (options.subgraphs) {
    validateArray(options.subgraphs, 'subgraphs')

    for (let i = 0; i < options.subgraphs.length; ++i) {
      const subgraph = options.subgraphs[i]
      const subgraphName = subgraph?.name || '#' + i

      if (validatedOptions.subgraphs.has(subgraphName)) {
        throw new TypeError(`subgraphs name ${subgraphName} is not unique`)
      }

      validatedOptions.subgraphs.set(subgraphName, validateSubgraphOptions(options.subgraphs[i], subgraphName, validatedOptions.defaultArgsAdapter))
    }
  }

  return validatedOptions
}

function validateSubgraphOptions (subgraph, subgraphName, defaultArgsAdapter) {
  const optionName = `subgraphs[${subgraphName}]`
  validateObject(subgraph, optionName)

  const validatedSubgraph = {
    name: subgraphName,
    server: validateSubgraphServerOptions(subgraph.server, optionName),
    entities: new Map()
  }

  if (subgraph.entities) {
    const optionEntitiesName = optionName + '.entities'
    validateObject(subgraph.entities, optionEntitiesName)

    const entityNames = Object.keys(subgraph.entities)
    for (let i = 0; i < entityNames.length; ++i) {
      const entityName = entityNames[i]

      validatedSubgraph.entities.set(entityName, validateSubgraphEntityOptions(subgraph.entities[entityName], entityName, optionEntitiesName, subgraphName, defaultArgsAdapter))
    }
  }

  return validatedSubgraph
}

function validateSubgraphServerOptions (subgraphServer, optionName) {
  const optionEntityServerName = optionName + '.server'
  validateObject(subgraphServer, optionEntityServerName)

  const validatedServer = {
    host: validateString(subgraphServer.host, optionEntityServerName + '.host'),
    composeEndpoint: validateString(subgraphServer.composeEndpoint, optionEntityServerName + '.composeEndpoint', DEFAULT_COMPOSE_ENDPOINT),
    graphqlEndpoint: validateString(subgraphServer.graphqlEndpoint, optionEntityServerName + '.graphqlEndpoint', DEFAULT_GRAPHQL_ENDPOINT)
  }

  return validatedServer
}

function validateSubgraphEntityOptions (entity, entityName, optionEntitiesName, subgraphName, defaultArgsAdapter) {
  const optionEntityName = optionEntitiesName + `.${entityName}`
  validateObject(entity, optionEntityName)

  const validatedEntity = {
    pkey: validateString(entity.pkey, optionEntityName + '.pkey'),
    fkeys: [],
    many: []
  }

  if (entity.fkeys) {
    const optionFKeyName = optionEntityName + '.fkeys'
    validateArray(entity.fkeys, optionFKeyName)
    for (let k = 0; k < entity.fkeys.length; ++k) {
      validatedEntity.fkeys.push(validateSubgraphEntityFKeyOptions(entity.fkeys[k], optionFKeyName + `[${k}]`, subgraphName, defaultArgsAdapter))
    }
  }

  if (entity.many) {
    const optionManyName = optionEntityName + '.many'
    validateArray(entity.many, optionManyName)
    for (let k = 0; k < entity.many.length; ++k) {
      validatedEntity.many.push(validateSubgraphEntityManyOptions(entity.many[k], optionManyName + `[${k}]`, subgraphName, defaultArgsAdapter))
    }
  }

  if (entity.resolver) {
    validatedEntity.resolver = validateResolver(entity.resolver, optionEntityName + '.resolver', defaultArgsAdapter ?? createDefaultArgsAdapter(validatedEntity.pkey))
  }

  return validatedEntity
}

function validateSubgraphEntityFKeyOptions (fkey, optionName, defaultSubgraph, defaultArgsAdapter) {
  const validatedFkey = {}
  for (const p of ['type']) {
    validatedFkey[p] = validateString(fkey[p], optionName + `.${p}`)
  }
  for (const p of ['field', 'as', 'pkey']) {
    if (!fkey[p]) { continue }
    validatedFkey[p] = validateString(fkey[p], optionName + `.${p}`)
  }

  validatedFkey.subgraph = validateString(fkey.subgraph, optionName + '.subgraph', defaultSubgraph)
  if (fkey.resolver) {
    validatedFkey.resolver = validateResolver(fkey.resolver, optionName + '.resolver', defaultArgsAdapter ?? createDefaultArgsAdapter(fkey.pkey))
  }

  return validatedFkey
}

function validateSubgraphEntityManyOptions (many, optionName, defaultSubgraph, defaultArgsAdapter) {
  const validatedMany = {}
  for (const p of ['type', 'as', 'pkey']) {
    validatedMany[p] = validateString(many[p], optionName + `.${p}`)
  }
  // TODO validate: fkey is not required for link
  if (many.fkey) {
    validatedMany.fkey = validateString(many.subgraph, optionName + '.fkey')
  }

  validatedMany.subgraph = validateString(many.subgraph, optionName + '.subgraph', defaultSubgraph)

  // TODO validate many.link
  // type, pkey, fkey, resolver
  if (many.link) {
    validatedMany.link.subgraph = validateString(many.link.subgraph, optionName + '.subgraph')
  }

  validatedMany.resolver = validateResolver(many.resolver, optionName + '.resolver', defaultArgsAdapter ?? createDefaultArgsAdapter(many.pkey))

  return validatedMany
}

function validateResolver (resolver, optionName, defaultArgsAdapter) {
  const validatedResolver = {
    name: validateString(resolver.name, optionName + '.name'),
    argsAdapter: undefined
  }

  if (!resolver.argsAdapter) {
    validatedResolver.argsAdapter = defaultArgsAdapter
  } else if (typeof resolver.argsAdapter === 'string') {
    validatedResolver.argsAdapter = metaline(resolver.argsAdapter)
  } else {
    validatedResolver.argsAdapter = validateFunction(resolver.argsAdapter, optionName + '.argsAdapter')
  }

  if (resolver.partialResults) {
    if (typeof validatedResolver.partialResults === 'string') {
      validatedResolver.partialResults = metaline(resolver.partialResults)
    } else {
      validatedResolver.partialResults = validateFunction(resolver.partialResults, optionName + '.partialResults')
    }
  }

  return validatedResolver
}

function validateDefaultArgsAdapterOptions (defaultArgsAdapter) {
  if (!defaultArgsAdapter) {
    return
  }
  if (typeof defaultArgsAdapter === 'string') {
    return metaline(defaultArgsAdapter)
  } else {
    validateFunction(defaultArgsAdapter, 'defaultArgsAdapter')
    return defaultArgsAdapter
  }
}

module.exports = {
  validateComposerOptions
}
