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

// collect args in a convenient structure, merging the arguments data from info, created args, args type and structure
function collectArgs (nodeArguments, info) {
  if (!nodeArguments || nodeArguments.length < 1) {
    return null
  }

  const args = []
  for (let i = 0; i < nodeArguments.length; i++) {
    // TODO variables
    args.push(argumentValue(nodeArguments[i]))
  }

  return args
}

function argumentValue (node, variables) {
  const kind = node.value.kind

  if (kind === 'ObjectValue') {
    return {
      name: node.name.value,
      value: node.value.fields.map(v => argumentValue(v, variables)),
      type: kind
    }
  } else if (kind === 'ListValue') {
    return {
      name: node.name.value,
      value: node.value.values.map(v => argumentValue({ value: v }, variables)),
      type: kind
    }
  } else if (kind === 'Variable') {
    // TODO variable
  } else {
    return {
      name: node.name?.value,
      value: node.value.value,
      type: kind
    }
  }
}

// function argumentValue(value) {
//   const kind = value.kind

//   if (kind === 'ObjectValue') {
//     const fields = node.value.fields.map(v => valueToArgumentString(v, variables))
//     return `${name} {${fields.join(',')}}`
//   } else if (kind === 'ListValue') {
//     const values = node.value.values.map(v => valueToArgumentString({ value: v }, variables))
//     return `${name} [${values.join(',')}]`
//   } else if (kind === 'StringValue') {
//     return `${name} "${node.value.value}"`
//   } else if (kind === 'Variable') {
//     const varName = node.value.name.value
//     const varValue = variables[varName]

//     if (typeof varValue === 'object') {
//       const fields = Object.keys(varValue).map((k) => {
//         let v = varValue[k]
//         if (typeof v === 'string') { v = `"${v}"` }
//         return `${k}: ${v}`
//       }).join(',')

//       return `${name} {${fields}}`
//     } else {
//       return `${name} ${varValue}`
//     }
//   } else {
//     console.log('!!!!', kind, name)
//     return `${name} ${node.value.value}`
//   }
// }

// if (kind === 'ObjectValue') {
//   const o = {}
//   for(const field of arg.value.fields) {
//     o[field.name] = { value: argumentValue(field.value), type: field.value.kind }
//   }
// } else if (kind === 'Variable') {
//   const varName = arg.value.name.value
//   const varValue = info.variableValues[varName]
//   if (typeof varValue === 'object') {
//     const object = {}
//     const keys = Object.keys(varValue)
//     for (let j = 0; j < keys.length; j++) {
//       // TODO recursive
//       object[keys[j]] = varValue[keys[j]]
//     }
//     args[name] = { value: object, type: 'ObjectValue' }
//     continue
//   }
//   args[name] = { value: varValue, type: 'asd' }
// } else {
//   args[name] = { value: arg.value.value, type: arg.value.kind }
// }

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
