'use strict'

/**
 * A QueryNode is a node on the query-tree resolution
 * @typedef {Object} QueryNode
 * @property {String} subgraphName
 */

/**
 * @returns {QueryNode}
 */
function createQueryNode ({ subgraphName, path, field, queryFieldNode, parent, query, deferred }) {
  if (deferred) {
    return { deferred }
  }

  return {
    subgraphName,
    path,
    field,
    queryFieldNode,
    parent,
    query
  }
}

function createQuery ({ operation = '', resolver, selection, args }) {
  return { operation, resolver, selection, args }
}

/**
 * @param {QueryNode} parent
 */
function createDeferredQuery ({ fieldName, queryFieldNode, parent, path }) {
  return { fieldName, queryFieldNode, parent, path }
}

// ---

/**
 * uniforms any result to an array, filters null row
 * @returns array
 */
function toArgsAdapterInput (result) {
  if (!result) { return [] }

  if (!Array.isArray(result)) {
    return [result]
  }

  // TODO flat?
  return result.filter(r => !!r)
}

function buildQuery (query, result) {
  if (query.resolver?.argsAdapter) {
    // TODO resolver.partialResults
    // TODO try-catch, log and so on
    const r = toArgsAdapterInput(result)
    query.args = query.resolver.argsAdapter(r)
  }

  return {
    query: `${query.operation} { ${query.resolver.name}${buildQueryArgs(query.args)} ${buildQuerySelection(query.selection)} }`,
    fieldName: query.resolver.name
  }
}

function buildQuerySelection (selection) {
  if (!(selection && selection.length > 0)) {
    return ''
  }

  const fields = []
  for (let i = 0; i < selection.length; i++) {
    if (selection[i].field) {
      fields.push(selection[i].field)
    } else if (selection[i].selection) {
      fields.push(buildQuerySelection(selection[i].selection))
    } else if (selection[i].nested) {
      fields.push(selection[i].selectionParent)
      for (const nested of selection[i].nested.values()) {
        fields.push(buildQuerySelection(nested.query.selection))
      }
    } else if (selection[i].deferreds) {
      // add keys to merge result later
      fields.push(selection[i].selectionParent)
      for (const deferred of selection[i].deferreds.values()) {
        // TODO optimization: add key by deferred query: add fkeys/many keys only when needed
        fields.push(buildQueryEntityKeys(deferred.parent.field.type))
      }
    } else if (selection[i].args) {
      // TODO buildQueryArgs
      fields.push('***TODO buildQuerySelection args***')
    }
  }

  return `{ ${fields.join(' ')} }`
}

function buildQueryEntityKeys (type) {
  return type.entity.pkey
}

// TODO filter same values
function buildQueryArgs (v, root = true) {
  if (v === undefined || v === null) { return '' }

  if (Array.isArray(v)) {
    const args = []
    for (let i = 0; i < v.length; i++) {
      const arg = buildQueryArgs(v[i], false)
      if (arg === '') { continue }
      args.push(arg)
    }
    return `[${args.join(', ')}]`
  }

  if (typeof v === 'object') {
    const keys = Object.keys(v)
    const args = []
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const value = buildQueryArgs(v[key], false)
      if (value === '') { continue }
      args.push(`${key}: ${value}`)
    }

    if (root) {
      return args?.length > 0 ? `(${args.join(',')})` : ''
    }
    return `{ ${args.join(', ')} }`
  }

  // TODO test: quotes
  return typeof v === 'string' ? `"${v}"` : v.toString()
}

// function buildQueryArg (node) {
//   const kind = node.kind

//   if (kind === 'ObjectValue') {
//     const fields = node.fields.map((f) => {
//       const name = f.name.value
//       const value = buildQueryArg(f.value)

//       return `${name}: ${value}`
//     })

//     return `{ ${fields.join(', ')} }`
//   } else if (kind === 'ListValue') {
//     const values = node.values.map(v => buildQueryArg(v))
//     return `[ ${values.join(', ')} ]`
//   } else if (kind === 'StringValue') {
//     return `"${node.value}"`
//   } else {
//     return node.value
//   }
// }

// function queryArgumentsString ({ node, info }) {
//   const length = node.arguments?.length ?? 0

//   if (length === 0) {
//     return ''
//   }

//   const args = node.arguments.map((a) => {
//     const name = a.name.value
//     let value

//     if (a.value.kind === 'Variable') {
//       const varName = a.value.name.value
//       const varValue = info.variableValues[varName]

//       if (typeof varValue === 'object') {
//         const kvs = Object.keys(varValue).map((k) => {
//           let v = varValue[k]

//           if (typeof v === 'string') {
//             v = `"${v}"`
//           }

//           return `${k}: ${v}`
//         }).join(', ')

//         value = `{ ${kvs} }`
//       } else {
//         value = varValue
//       }
//     } else {
//       value = buildQueryArg(a.value)
//     }

//     return `${name}: ${value}`
//   })

//   return `(${args.join(', ')})`
// }

module.exports = {
  createQueryNode,
  createQuery,
  createDeferredQuery,

  buildQuery
}
