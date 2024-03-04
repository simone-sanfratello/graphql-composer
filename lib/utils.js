'use strict'

function defaultOnError (error) { throw error }

function createDefaultArgsAdapter (pkey) {
  return function argsAdapter (partialResults) {
    return { [pkey + 's']: partialResults.map(r => r[pkey]) }
  }
}

function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

// deep clone with support for function type
function objectDeepClone (object) {
  if (object === null || object === undefined) {
    return object
  }

  if (Array.isArray(object)) {
    const clone = []
    for (let i = 0; i < object.length; i++) {
      clone[i] = objectDeepClone(object[i])
    }
    return clone
  }

  if (typeof object === 'object') {
    const clone = {}
    const keys = Object.keys(object)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      clone[key] = objectDeepClone(object[key])
    }
    return clone
  }

  // TODO clone Map and Set too?
  return object
}

// copy values from src to to, recursively without overriding
function copyObjectByKeys (to, src) {
  const keys = Object.keys(src)
  for (let i = 0; i < keys.length; i++) {
    if (typeof to[keys[i]] === 'object') {
      copyObjectByKeys(to[keys[i]], src[keys[i]])
    } else {
      to[keys[i]] ??= src[keys[i]]
    }
  }
}

function mergeMaps (m1, m2) {
  for (const [k, v] of m2) {
    m1.set(k, v)
  }
}

function pathJoin (...args) {
  let p = ''
  for (let i = 0; i < args.length; i++) {
    if (i > 0 && args[i] && p) {
      p += '.' + args[i]
    } else if (args[i]) {
      p = args[i]
    }
  }
  return p
}

// -- gql utilities

function unwrapFieldTypeName (field) {
  return field.type.name || field.type.ofType.name || field.type.ofType.ofType.name
}

function collectArgs (nodeArguments, info) {
  if (!nodeArguments || nodeArguments.length < 1) {
    return {}
  }
  const args = {}
  for (let i = 0; i < nodeArguments.length; i++) {
    const arg = nodeArguments[i]
    const name = arg.name.value
    const kind = arg.value.kind

    if (kind === 'ObjectValue') {
      console.log(arg)
    } else if (kind === 'Variable') {
      const varName = arg.value.name.value
      const varValue = info.variableValues[varName]
      if (typeof varValue === 'object') {
        const object = {}
        const keys = Object.keys(varValue)
        for (let j = 0; j < keys.length; j++) {
          // TODO recursive
          object[keys[j]] = varValue[keys[j]]
        }
        args[name] = { value: object, type: 'ObjectValue' }
        continue
      }
      args[name] = { value: varValue, type: 'asd' }
    } else {
      args[name] = { value: arg.value.value, type: arg.value.kind }
    }
  }

  return args
}

function schemaTypeName (types, subgraphName, entityName, fieldName) {
  const t = types[entityName][subgraphName].fields.get(fieldName).src.type
  const notNull = t.kind === 'NON_NULL' ? '!' : ''
  return (t.name || t.ofType.name) + notNull
}

module.exports = {
  defaultOnError,
  createDefaultArgsAdapter,
  isObject,
  objectDeepClone,
  copyObjectByKeys,
  mergeMaps,
  pathJoin,

  collectArgs,
  unwrapFieldTypeName,
  schemaTypeName
}
