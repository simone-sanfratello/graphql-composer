'use strict'

const pino = require('pino')

function defaultOnError (error) { throw error }

function dummyLogger () {
  return pino({ level: 'silent' })
}

function createDefaultArgsAdapter (pkey) {
  return function argsAdapter (partialResults) {
    return { [pkey + 's']: partialResults.map(r => r[pkey]) }
  }
}

function isObject (obj) {
  return obj !== null && typeof obj === 'object'
}

function copyObjectByKeys (to, src) {
  const keys = Object.keys(src)
  for (let i = 0; i < keys.length; i++) {
    to[keys[i]] = src[keys[i]]
  }
}

// -- gql utilities

function unwrapFieldTypeName (field) {
  return field.type.name || field.type.ofType.name || field.type.ofType.ofType.name
}

// function traverseResult (result, path) {
//   if (Array.isArray(result)) {
//     result = result.map(r => {
//       const n = traverseResult(r, path)
//       return n
//     })
//     return result
//   }
//   return result[path] ?? null
// }

// function unwrapFieldType (node) {
//   let t = node.type
//   while (t.kind === 'NON_NULL' || t.kind === 'LIST') {
//     t = t.ofType
//   }
//   return t
// }

// function schemaTypeName (types, entityName, field) {
//   const t = types.get(entityName).fieldMap.get(field).schemaNode.type
//   const notNull = t.kind === 'NON_NULL' ? '!' : ''
//   return (t.name || t.ofType.name) + notNull
// }

// function collectArgs ({ queryFieldNode, info }) {
//   if (!queryFieldNode.arguments || queryFieldNode.arguments.length < 1) {
//     return {}
//   }
//   const args = {}
//   for (let i = 0; i < queryFieldNode.arguments.length; i++) {
//     const a = queryFieldNode.arguments[i]
//     const name = a.name.value
//     if (a.value.kind !== 'Variable') {
//       args[name] = a.value.value
//       continue
//     }
//     const varName = a.value.name.value
//     const varValue = info.variableValues[varName]
//     if (typeof varValue === 'object') {
//       // TODO check this
//       const object = {}
//       const keys = Object.keys(varValue)
//       for (let j = 0; j < keys.length; j++) {
//         object[keys[j]] = varValue[keys[j]]
//       }
//       args[name] = object
//       continue
//     }
//     args[name] = varValue
//   }
//   return args
// }

module.exports = {
  defaultOnError,
  dummyLogger,
  createDefaultArgsAdapter,
  isObject,
  copyObjectByKeys,

  unwrapFieldTypeName
}
