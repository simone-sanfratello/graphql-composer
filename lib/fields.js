'use strict'

const QUERY_TYPE = 'QUERY'
const MUTATION_TYPE = 'MUTATION'

/**
 * merge only entity types
 */
function mergeTypes (t1, t2) {
  if (t1.src.kind !== 'OBJECT' || !Array.isArray(t1.src.fields)) {
    return t1
  }
  t1.src.fields = t1.src.fields.concat(t2.src.fields)

  // TODO t1.fields = t1.fields.concat(t2.fields)
  // TODO fields.resolvers

  return t1
}

function cloneType (type) {
  const { fields, entity, ...rest } = type
  return {
    fields: cloneFields(fields),
    entity: cloneEntity(entity),
    ...structuredClone(rest)
  }
}

function cloneFields (fields) {
  const f = new Map()
  for (const [k, v] of fields) {
    const { resolver, ...rest } = v
    f.set(k, { resolver, ...structuredClone(rest) })
  }

  return f
}

function cloneEntity (entity) {
  if (!entity) { return entity }
  const { resolver, ...rest } = entity
  return {
    resolver,
    ...structuredClone(rest)
  }
}

function getMainType (schema, type) {
  if (schema.queryType?.name === type.name) { return QUERY_TYPE }
  if (schema.mutationType?.name === type.name) { return MUTATION_TYPE }
}

function createType ({ name, src, fields, entity }) {
  return {
    name,
    src,
    fields: fields ?? [],
    entity
  }
}

function createField ({ name, info, src, resolver }) {
  return {
    name,
    src,
    info,
    resolver
  }
}

module.exports = {
  QUERY_TYPE,
  MUTATION_TYPE,
  mergeTypes,
  cloneType,
  getMainType,
  createType,
  createField
}
