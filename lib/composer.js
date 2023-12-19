'use strict'

const { buildClientSchema, printSchema } = require('graphql')
const { getIntrospectionQuery } = require('graphql')
const fastify = require('fastify')
const mercurius = require('mercurius')

const { fetchSubgraphSchema, makeGraphqlRequest } = require('./network')
const { validateComposerOptions } = require('./validation')
const { QUERY_TYPE, MUTATION_TYPE, cloneType, mergeTypes, getMainType, createType, createField } = require('./fields')
const { collectQueries } = require('./query')

class Composer {
  constructor (options = {}) {
    this.mergedSchema = { _built: false }
    this.schemas = []
    this.mainTypes = new Set()
    this.resolvers = {}

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

    // this.types[typeName][subgraphName] = { src, fields, entity }
    this.types = {}
    // this.fields[typeName.fieldName][subgraphName] = { src, typeName, resolver }
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

  // TODO return a copy
  getResolvers () {
    return { ...this.resolvers }
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
        this.mergedSchema.types.set(typeName, t ? mergeTypes(t, type) : cloneType(type))
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
      const type = schema.types[i]
      const typeName = type.name

      // Ignore built in types
      if (typeName.startsWith('__')) {
        continue
      }

      // Query or Mutation
      const mainType = getMainType(schema, type)
      if (mainType) {
        this.mainTypes.add(mainType)
      }

      if (!Array.isArray(type.fields)) {
        // not an entity type, just collect
        this.addType(typeName, subgraphName, type, null, null)
        continue
      }

      const entity = this.getEntity(typeName, subgraphName)
      const fields = new Map()
      for (let i = 0; i < type.fields.length; ++i) {
        const field = type.fields[i]
        let resolver

        if (mainType) { // TODO or entity.fkey.as || entity.many.as ...
          resolver = this.createResolver({
            typeName,
            subgraphName,
            field
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
        const f = this.addField(typeName, field, subgraphName, resolver)
        fields.set(field.name, f)
      }

      this.addType(typeName, subgraphName, type, entity, fields)
    }
  }

  addType (typeName, subgraphName, type, entity, fields) {
    this.logger.debug({ typeName, subgraphName }, 'composer.addType')

    if (this.types[typeName] && this.types[typeName][subgraphName]) {
      this.logger.warn('TODO type already exists on subgraph')
      return
    }

    const t = createType({ name: typeName, src: type, fields, entity })
    if (!this.types[typeName]) {
      this.types[typeName] = { [subgraphName]: t }
      return
    }

    this.types[typeName][subgraphName] = t
  }

  addField (typeName, field, subgraphName, resolver) {
    const fieldName = `${typeName}.${field.name}`
    this.logger.debug({ fieldName, subgraphName }, 'composer.addField')

    if (this.fields[fieldName] && this.fields[fieldName][subgraphName]) {
      this.logger.warn('TODO field already exists on subgraph')
      return
    }

    // TODO info: type name, nullable, list(of types)

    const f = createField({ name: field.name, info: 'TODO', src: field, resolver })
    if (!this.fields[fieldName]) {
      this.fields[fieldName] = { [subgraphName]: f }
      return
    }

    this.fields[fieldName][subgraphName] = f
    return f
  }

  getEntity (typeName, subgraphName) {
    return this.types[typeName]?.[subgraphName]?.entity
  }

  /**
   * get types by subgraphName
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

  getSubgraphs () {
    // TODO memoize
    return Object.fromEntries(this.subgraphs)
  }

  createResolver ({ typeName, subgraphName, field }) {
    this.logger.debug({ typeName, subgraphName, fieldName: field.name }, 'composer.createResolver')
    const types = this.getTypes(subgraphName)
    const subgraphs = this.getSubgraphs()

    return async (parent, args, context, info) => {
      const queries = collectQueries({
        types,
        subgraps: subgraphs,
        typeName,
        subgraphName,
        field,
        parent,
        args,
        context,
        info
      })

      // TODO collect queries by: subgraph, non-dependent
      // run parallel
      // run as soon as they are resolved by parent resolvers
      const result = {}
      for (const q of queries) {
        // TODO query can have variables
        // TODO logger.debug({ subgraph: q.subgraphName, query: q.query }, 'run subgraph query')
        const data = await makeGraphqlRequest(q.query, subgraphs[q.subgraphName].server)

        // TODO logger.debug({ query: q.query, data }, 'query result')

        // TODO merge result at the end
        result[q.resolverName] = data[q.resolverName]
      }

      return result[field.name]
    }
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

module.exports = { Composer }
