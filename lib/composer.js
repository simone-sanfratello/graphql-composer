'use strict'

const { buildClientSchema, printSchema } = require('graphql')
const { getIntrospectionQuery } = require('graphql')
const fastify = require('fastify')
const mercurius = require('mercurius')

const { fetchSubgraphSchema, makeGraphqlRequest } = require('./network')
const { validateComposerOptions } = require('./validation')
const { QUERY_TYPE, MUTATION_TYPE, mergeTypes, getMainType, createType, createField, createFieldId } = require('./fields')
const { buildQuery, queryParentResult } = require('./query-builder')
const { collectQueries } = require('./query-lookup')
const { unwrapFieldTypeName, objectDeepClone } = require('./utils')
const { mergeResult } = require('./result')
const { entityKeys } = require('./entity')

/**
 * @typedef {Object} ComposerField
 * @property {Object} src - graphql field definition
 * @property {string} typeName - field type name, for example "Author"
 * @property {Resolver} resolver
 */

/**
 * fields[typeName.fieldName][subgraphName] = { src, typeName, resolver }
 * @typedef {Object.<string, Object.<string, ComposerField>>} ComposerFields
 * @example fields['Book.id']['books-subgraph'] = { src, typeName, resolver }
 */

/**
 * @typedef {Object} ComposerType
 * @property {Object} src - graphql type definition
 * @property {Map<string, ComposerField>} fields - type field's, where the key is the field name
 * @property {Entity} entity
 */

/**
 * types[typeName][subgraphName] = { src, fields, entity }
 * @typedef {Object.<string, Object.<string, ComposerType>>} ComposerTypes
 * @example types['Book']['books-subgraph'] = { src, fields, entity }
 */

class Composer {
  constructor (options = {}) {
    this.mergedSchema = { _built: false }
    this.schemas = []
    this.mainTypes = new Set()
    this.resolvers = Object.create(null)

    const v = validateComposerOptions(options)

    this.logger = v.logger
    this.schemaOptions = {
      [QUERY_TYPE]: {
        schemaPropertyName: 'queryType',
        name: v.queryTypeName
      },
      [MUTATION_TYPE]: {
        schemaPropertyName: 'mutationType',
        name: v.mutationTypeName
      }
    }
    this.addEntitiesResolvers = v.addEntitiesResolvers
    this.onSubgraphError = v.onSubgraphError
    this.subgraphs = v.subgraphs
    this.defaultArgsAdapter = v.defaultArgsAdapter

    /** @type ComposerTypes */
    this.types = {}
    /** @type ComposerFields */
    this.fields = {}
  }

  toSchema () {
    const schema = {
      queryType: undefined,
      mutationType: undefined,
      types: [],
      // TODO support directives
      directives: []
    }

    for (const mainType of this.mainTypes.values()) {
      const s = this.schemaOptions[mainType]
      schema[s.schemaPropertyName] = { name: s.name }
    }

    for (const type of this.mergedSchema.types.values()) {
      schema.types.push(type.src)
    }

    return { __schema: schema }
  }

  toSdl () {
    return printSchema(buildClientSchema(this.toSchema()))
  }

  async compose () {
    this.schemas = await this.fetchSubgraphSchemas()

    for (let i = 0; i < this.schemas.length; ++i) {
      this.mergeSchema(this.schemas[i])
    }

    if (this.addEntitiesResolvers) {
      await this.setupComposerSubgraph()
    }

    this.buildMergedSchema()
  }

  // TODO return a copy to avoid writes on resolvers
  getResolvers () {
    return { ...this.resolvers }
  }

  deferredSubgraph (typeName, fieldName) {
    const fieldId = createFieldId(typeName, fieldName)
    const field = this.fields[fieldId]
    if (!field) {
      // TODO log err
      console.log('deferredSubgraph no field', fieldId)
    }
    // TODO in case of multiple subgraph to resolve the same field
    return Object.keys(field)[0]
  }

  buildMergedSchema () {
    this.mergedSchema = {
      types: new Map(),
      _built: false
    }

    const typeNames = Object.keys(this.types)
    // TODO handle different Query or Mutation type name between subgraphs
    for (let i = 0; i < typeNames.length; ++i) {
      const typeName = typeNames[i]

      const subgraphNames = Object.keys(this.types[typeName])
      for (let j = 0; j < subgraphNames.length; ++j) {
        const subgraphName = subgraphNames[j]

        const type = this.types[typeName][subgraphName]

        const t = this.mergedSchema.types.get(typeName)

        // TODO handle conflicts by name or type, add option to rename, mask or hide
        this.mergedSchema.types.set(typeName, t ? mergeTypes(t, type) : objectDeepClone(type))
      }
    }

    this.mergedSchema._built = true
  }

  /**
   * setup a dry service as composer node
   */
  async setupComposerSubgraph () {
    const { schema, resolvers, entities } = this.resolveEntities()

    // no entities to add, no need the composer subgraph
    if (!schema) { return }

    const instance = fastify()
    instance.register(mercurius, { schema, resolvers })
    instance.get('/i', (_, reply) => reply.graphql(getIntrospectionQuery()))
    await instance.ready()

    const subgraphName = '__composer__'
    const subgraph = {
      name: subgraphName,
      server: {
        instance,
        graphqlEndpoint: '/graphql'
      },
      entities
    }
    this.subgraphs.set(subgraphName, subgraph)

    const introspection = await instance.inject('/i')
    const subgraphSchema = JSON.parse(introspection.body).data
    subgraphSchema.subgraphName = subgraphName

    this.mergeSchema(subgraphSchema)
  }

  async fetchSubgraphSchemas () {
    const subgraphs = Array.from(this.subgraphs.values())

    const requests = subgraphs.map((subgraph) => {
      return fetchSubgraphSchema(subgraph.server)
    })

    const responses = await Promise.allSettled(requests)
    const schemas = []

    for (let i = 0; i < responses.length; ++i) {
      const { status, value: introspection } = responses[i]
      const subgraph = subgraphs[i]

      if (status !== 'fulfilled') {
        const msg = `Could not process schema for subgraph '${subgraph.name}' from '${subgraph.server.host}'`

        this.onSubgraphError(new Error(msg, { cause: responses[i].reason }), subgraph.name)
        continue
      }

      introspection.subgraphName = subgraph.name
      schemas.push(introspection)
    }

    return schemas
  }

  mergeSchema ({ __schema: schema, subgraphName }) {
    if (!schema) {
      return
    }
    // TODO test subgraph with different Query or Mutation names

    for (let i = 0; i < schema.types.length; ++i) {
      const schemaType = schema.types[i]
      const typeName = schemaType.name

      // Ignore built in types
      if (typeName.startsWith('__')) {
        continue
      }

      // Query or Mutation
      const mainType = getMainType(schema, schemaType)
      if (mainType) {
        this.mainTypes.add(mainType)
      }

      if (!Array.isArray(schemaType.fields)) {
        // not an entity type, just collect
        this.addType(typeName, subgraphName, schemaType)
        continue
      }

      const entity = this.getEntity(typeName, subgraphName)
      const type = this.addType(typeName, subgraphName, schemaType, entity)
      type.fields = new Map()
      for (let i = 0; i < schemaType.fields.length; ++i) {
        const field = schemaType.fields[i]
        let resolver

        if (mainType) { // TODO or entity.fkey.as || entity.many.as ...
          resolver = this.createResolver({
            typeName,
            subgraphName,
            fieldSrc: field
          })

          this.resolvers[typeName] ??= Object.create(null)
          this.resolvers[typeName][field.name] = resolver
        }

        // TODO alias for conflicting types, for example
        // subgraph#1: type Pizza { id: ID }
        // subgraph#2: type Pizza { id: Int! }
        // options: { ... subgraph#1: { entities: { Pizza: { id: { as: 'optionalId' ...
        // result: type Pizza { optionalId: ID (from subgraph#1), id: Int! (from subgraph#2) }

        // TODO option to hide fields
        // note: type may not be available at this point, only typeName
        const f = this.addField(typeName, field, subgraphName, type, resolver)
        type.fields.set(field.name, f)
      }
    }

    // fill types in fields by typename
    for (const fieldId of Object.keys(this.fields)) {
      for (const subgraphName of Object.keys(this.fields[fieldId])) {
        const f = this.fields[fieldId][subgraphName]
        f.type = this.types[f.typeName][subgraphName]
      }
    }
  }

  addType (typeName, subgraphName, type, entity) {
    // this.logger.debug({ typeName, subgraphName }, 'composer.addType')

    if (this.types[typeName] && this.types[typeName][subgraphName]) {
      this.logger.warn('TODO type already exists on subgraph')
      return
    }

    const t = createType({ name: typeName, src: type, entity })
    if (!this.types[typeName]) {
      this.types[typeName] = { [subgraphName]: t }
      return t
    }

    this.types[typeName][subgraphName] = t
    return t
  }

  addField (parentTypeName, field, subgraphName, parent, resolver) {
    // this.logger.debug({ fieldName: field.name, subgraphName }, 'composer.addField')
    const fieldId = createFieldId(parentTypeName, field.name)

    if (this.fields[fieldId] && this.fields[fieldId][subgraphName]) {
      this.logger.warn('TODO field already exists on subgraph')
      return
    }

    const typeName = unwrapFieldTypeName(field)
    const f = createField({ name: field.name, typeName, src: field, parent, resolver })
    if (!this.fields[fieldId]) {
      this.fields[fieldId] = { [subgraphName]: f }
      return f
    }

    this.fields[fieldId][subgraphName] = f
    return f
  }

  getEntity (typeName, subgraphName) {
    const subgraph = this.subgraphs.get(subgraphName)
    if (subgraph) {
      return subgraph.entities.get(typeName)
    }
  }

  /**
   * get existing types on subgraph
   */
  getTypes (subgraphName) {
    // TODO memoize
    const types = {}
    const typeNames = Object.keys(this.types)
    for (let i = 0; i < typeNames.length; ++i) {
      const typeName = typeNames[i]

      const subgraphNames = Object.keys(this.types[typeName])
      for (let j = 0; j < subgraphNames.length; ++j) {
        const s = subgraphNames[j]
        if (s !== subgraphName) { continue }

        types[typeName] = this.types[typeName][s]
      }
    }
    return types
  }

  /**
   * get existing types on subgraph
   */
  getFields (subgraphName) {
    // TODO memoize
    const fields = {}
    const fieldIds = Object.keys(this.fields)
    for (let i = 0; i < fieldIds.length; ++i) {
      const fieldName = fieldIds[i]

      const subgraphNames = Object.keys(this.fields[fieldName])
      for (let j = 0; j < subgraphNames.length; ++j) {
        const s = subgraphNames[j]
        if (s !== subgraphName) { continue }

        fields[fieldName] = this.fields[fieldName][s]
      }
    }
    return fields
  }

  createResolver ({ typeName, subgraphName, fieldSrc }) {
    // this.logger.debug({ typeName, subgraphName, fieldName: fieldSrc.name }, 'composer.createResolver')

    return async (parent, args, context, info) => {
      return this.runResolver({ typeName, subgraphName, fieldSrc, parent, args, context, info })
    }
  }

  async runResolver ({ typeName, subgraphName, fieldSrc, parent, args, context, info }) {
    const queries = this.collectQueries({
      typeName,
      subgraphName,
      fieldSrc,
      parent,
      args,
      context,
      info
    })

    const result = await this.runQueries(queries)
    return result[fieldSrc.name]
  }

  /**
   * collect queries starting from the resolver fn
   */
  collectQueries ({
    // resolver generator
    typeName, subgraphName, fieldSrc,
    // resolver args
    parent, args, context, info
  }) {
    const types = this.getTypes(subgraphName)
    const fields = this.getFields(subgraphName)

    const queries = new Map()
    for (const queryFieldNode of info.fieldNodes) {
      const fieldId = createFieldId(info.parentType.name, queryFieldNode.name.value)
      const q = collectQueries({
        subgraphName,
        queryFieldNode,
        fieldId,
        args,
        types,
        fields,
        info,
        root: true,
        logger: this.logger
      })
      this.buildQueries(q, queries, info)
    }

    return queries
  }

  // TODO add resolution strategy here
  // - traverse horizontally, collect by subgraph/parent resolution
  buildQueries (collectedQueries, queries, info) {
    for (const [path, query] of collectedQueries.queries) {
      if (queries.has(path)) {
        this.logger.warn({ path }, 'adding query but path already exists')
      }

      // fill deferred info: keys
      for (let i = 0; i < query.query.selection.length; i++) {
        const s = query.query.selection[i]
        if (s.deferreds) {
          for (const deferred of s.deferreds.values()) {
            deferred.keys = entityKeys(deferred.parent.field) // , query.subgraphName)
          }
        }
      }

      // TODO calculate if entity keys are needed: keys are not needed when there are no deferred queries depending on quering entity
      // TODO add entities data here: node, parent, as, resolver...
      query.query.selection.push(...entityKeys(query.field, query.subgraphName).map(key => ({ key })))

      queries.set(path, query)
    }

    for (const deferred of collectedQueries.deferreds.values()) {
      const deferredQueriesBatch = this.buildDeferredQueries(deferred, info)
      for (const deferredQueries of deferredQueriesBatch) {
        // TODO link deferred query to generated query/ies
        for (const query of deferredQueries.queries.values()) {
          const entity = this.getEntity(query.parent.field.typeName, query.subgraphName)
          query.query.selection.push({ field: entity.pkey })
          query.query.selection.push(...deferred.selection)
        }

        this.buildQueries(deferredQueries, queries, info)
      }
    }
  }

  buildDeferredQueries (deferred, info) {
    const queries = []
    // this.logger.debug({ fieldName, parent }, 'composer.buildDeferredQueries')
    for (const { fieldName, queryFieldNode } of deferred.fields) {
      const fieldId = createFieldId(deferred.parent.field.typeName, fieldName)
      const subgraphName = this.deferredSubgraph(deferred.parent.field.typeName, fieldName)
      // TODO if (!this.fields[fieldId][subgraphName]) {
      //   log.error, on error, throw new Error('Unknown field ' + fieldId ...
      // }

      const entity = this.getEntity(deferred.parent.field.typeName, subgraphName)
      const resolver = deferredResolver(entity, deferred.keys, subgraphName)

      // TODO if !entity > error
      const types = this.getTypes(subgraphName)
      const fields = this.getFields(subgraphName)

      // collectQueries on deferred subgraph
      const q = collectQueries({
        subgraphName,
        queryFieldNode,
        path: deferred.path,
        fieldId,
        parent: deferred.parent,
        types,
        fields,
        info,
        // args?
        // override/extends by entity
        self: true,
        resolver,
        logger: this.logger
      })

      queries.push(q)
    }

    return queries
  }

  /**
   * run queries to fullfil a request
   *
   * TODO setup queries plan here
   * TODO collect queries by: subgraph, non-dependent, fields, keys for entities involved
   * TODO run parallel / same subgraph when possible
   * @param {*} queries map (path, queryNode)
   * @returns {*} merged result
   */
  async runQueries (queries) {
    const result = {}
    for (const [path, q] of queries) {
      const parentResult = this.getParentResult(q)

      const { query, fieldName, keys } = buildQuery(q.query, parentResult)
      // TODO query can have variables
      this.logger.debug({ subgraph: q.subgraphName, query }, 'run subgraph query')

      const data = await makeGraphqlRequest(query, this.subgraphs.get(q.subgraphName).server)

      this.logger.debug({ query, data }, 'query result')

      q.result = data[fieldName]
      q.keys = keys

      mergeResult(result, path, q, parentResult)
    }

    return result
  }

  /**
   * collect parent info by result to build query and merge the result
   */
  getParentResult (queryNode) {
    const q = queryParentResult(queryNode.parent)
    // TODO createParentResult
    const result = {
      path: [],
      data: undefined,
      keys: {
        self: queryNode.field.parent.entity?.pkey,
        parent: undefined
      }
    }

    if (!q) {
      return result
    }

    result.data = q.result

    // keys here are from "buildQuery"
    if (q.keys.length > 0) {
      const key = parentKey(q.keys, queryNode.field.parent.name)
      if (key) {
        result.path = key.split('.')
        result.keys.parent = result.path.at(-1)
      }
    }

    if (!result.keys.parent) {
      result.keys.parent = q.field.type.entity?.pkey
      result.path = [result.keys.parent]
    }

    return result
  }

  /**
   * generate schema and resolvers to resolve subgraphs entities
   * from sugraphs schemas and entities configuration
   */
  // resolveEntities () {
  //   const topSchema = []
  //   const topResolvers = { Query: {} }
  //   const topEntities = {}
  //   const topSchemaQueries = []
  //   const topQueriesResolvers = {}

  //   const entitiesKeys = Object.keys(this.entities)
  //   if (entitiesKeys.length < 1) {
  //     return { schema: undefined, resolvers: undefined, entities: undefined }
  //   }

  //   for (const entityName of entitiesKeys) {
  //     topEntities[entityName] = {
  //       pkey: this.entities[entityName].pkey,
  //       fkeys: new Map()
  //     }
  //   }

  //   for (const entityName of entitiesKeys) {
  //     const entity = this.entities[entityName]
  //     const entitySchemaFields = {}
  //     const entityResolverFields = {}

  //     // pkey
  //     const type = schemaTypeName(this.types, entityName, entity.pkey)
  //     entitySchemaFields[entity.pkey] = type

  //     // fkeys
  //     for (const fkey of entity.fkeys) {
  //       setEntityFKey(topEntities[entityName].fkeys, fkey)
  //       entitySchemaFields[fkey.as] = fkey.type

  //       // resolver will be replaced on query building
  //     }

  //     // many
  //     for (const many of entity.many) {
  //       entitySchemaFields[many.as] = `[${many.type}]`

  //       // resolver will be replaced on query building
  //     }

  //     const fields = Object.entries(entitySchemaFields)
  //       .map(([k, v]) => `${k}: ${v}`)
  //       .join(', ')
  //     topSchema.push(`type ${entityName} { ${fields} }`)
  //     topResolvers[entityName] = entityResolverFields
  //   }

  //   // cleanup outcome

  //   if (topSchemaQueries.length > 0) {
  //     topSchema.push(`type Query {\n  ${topSchemaQueries.join('\n  ')}\n}`)
  //     topResolvers.Query = topQueriesResolvers
  //   } else {
  //     topSchema.push('type Query {\n  _composer: String \n}')
  //     topResolvers.Query = { _composer: function _composer () { return '_composer' } }
  //   }

  //   for (const name of Object.keys(topEntities)) {
  //     const entity = topEntities[name]
  //     entity.fkeys = Array.from(entity.fkeys.values())
  //     this.addEntity(name, entity)
  //   }

  //   return { schema: topSchema.join('\n\n'), resolvers: topResolvers, entities: topEntities }
  // }
}

function parentKey (keys, type) {
  for (const k of keys) {
    if (k.fkey && k.fkey.type === type) {
      return k.fkey.field ?? k.fkey.pkey
    }
    // TODO many
  }
}

function deferredResolver (entity, deferredKeys, subgraphName) {
  if (!deferredKeys) {
    return entity.resolver
  }

  for (const key of deferredKeys) {
    if (key.fkey && key.fkey.subgraph === subgraphName) {
      return key.fkey.resolver
    }
  }

  return entity.resolver
}

module.exports = { Composer }
