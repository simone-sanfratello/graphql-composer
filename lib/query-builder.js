'use strict'

const { traverseResult } = require('./result')

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
function toArgsAdapterInput (result, path) {
  if (!result) { return [] }

  if (!Array.isArray(result)) {
    return [result]
  }

  // TODO flat?
  let r = result.filter(r => !!r)

  if (!path) {
    return r
  }

  // TODO use a specific fn instead of traverseResult to speed up
  let i = 0
  while (i < path.length - 1) {
    r = traverseResult(r, path[i])
    i++
  }

  return r
}

function buildQuery (query, subgraphName, parentResult, resultPath) {
  const { selection, keys } = buildQuerySelection(query.selection, subgraphName)

  if (query.resolver?.argsAdapter) {
    // TODO resolver.partialResults
    // TODO try-catch, log and so on
    const r = toArgsAdapterInput(parentResult, resultPath)
    // TODO filter duplicates
    query.args = query.resolver.argsAdapter(r)
  }

  return {
    query: `${query.operation} { ${query.resolver.name}${buildQueryArgs(query.args)} ${selection} }`,
    fieldName: query.resolver.name,
    keys
  }
}

// get keys to reuse on merge results
function buildQuerySelection (selection, subgraphName) {
  if (!(selection && selection.length > 0)) {
    return { selection: '', keys: [] }
  }

  const fields = []
  const keys = []
  for (let i = 0; i < selection.length; i++) {
    if (selection[i].field) {
      fields.push(selection[i].field)
    } else if (selection[i].selection) {
      // TODO keys?
      fields.push(buildQuerySelection(selection[i].selection, subgraphName).selection)
    } else if (selection[i].nested) {
      fields.push(selection[i].parentField)
      for (const nested of selection[i].nested.values()) {
        // TODO keys?
        fields.push(buildQuerySelection(nested.query.selection, subgraphName).selection)
      }
    } else if (selection[i].deferreds) {
      // add keys to merge result later
      for (const deferred of selection[i].deferreds.values()) {
        // TODO optimization: add key by deferred query: add fkeys/many keys only when needed
        const dkeys = entityKeys(deferred.parent.field, subgraphName)
        fields.push(...dkeys.map(k => toQuerySelection(k.pkey)))
        keys.push(...dkeys)
      }
    } else if (selection[i].args) {
      // TODO buildQueryArgs
      fields.push('***TODO buildQuerySelection args***')
    }
  }

  return { selection: `{ ${fields.join(' ')} }`, keys }
}

// TODO move this logic to composer
function entityKeys (field, subgraphName) {
  const keys = []
  if (field.type.entity?.pkey) {
    keys.push(field.type.entity.pkey)
  }
  if (field.parent?.entity) {
    if (field.parent?.entity.fkeys.length > 0) {
      // TODO performant code
      const fkeys = field.parent.entity.fkeys
        .filter(k => field.typeName === k.type && subgraphName === k.subgraph)

      keys.push(...fkeys)
    }
  }
  return keys
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

// TODO faster code
function toQuerySelection (key) {
  return key.split('.').reduce((q, f, i) => {
    return q + (i > 0 ? `{${f}}` : f)
  }, '')
}

// get parent by result
// parent also has result keys
function queryParentResult (queryParent) {
  if (!queryParent) { return }

  let parent = queryParent
  while (parent && !parent.result) {
    parent = parent.parent
  }

  return parent
}

module.exports = {
  createQueryNode,
  createQuery,
  createDeferredQuery,

  queryParentResult,

  buildQuery
}
