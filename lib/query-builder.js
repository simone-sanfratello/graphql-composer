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
function createQueryNode ({ subgraphName, path, field, queryFieldNode, parent, root, query, deferred }) {
  if (deferred) {
    return { deferred }
  }

  return {
    subgraphName,
    path,
    field,
    queryFieldNode,
    parent,
    root,
    query,
    result: undefined,
    keys: []
  }
}

function createQuery ({ operation = '', resolver, selection, args }) {
  return { operation, resolver, selection, args }
}

/**
 * @param {QueryNode} queryNode
 */
function createDeferredQuery ({ queryNode, resolverPath, fieldPath }) {
  return {
    subgraphName: undefined,
    queryNode,
    resolverPath,
    fieldPath,
    entity: undefined,
    keys: undefined,
    fields: []
  }
}

function addDeferredQueryField (query, fieldName, queryFieldNode) {
  query.fields.push({ fieldName, queryFieldNode })
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

  let r = result.filter(r => !!r)

  if (!path) {
    return r.flat()
  }

  // TODO use a specific fn instead of traverseResult to speed up
  let i = 0
  while (i < path.length - 1) {
    const t = traverseResult(r, path[i])
    if (!t) { break }
    r = t
    i++
  }

  return r.flat()
}

function buildQuery (query, parentResult) {
  const { selection, keys } = buildQuerySelection(query.selection)

  if (query.resolver?.argsAdapter) {
    // TODO try-catch, logs and so on

    // TODO filter duplicates in toArgsAdapterInput
    let r = toArgsAdapterInput(parentResult.data, parentResult.path)

    if (query.resolver.partialResults) {
      r = query.resolver.partialResults(r)
    }

    query.args = query.resolver.argsAdapter(r)
  }

  return {
    query: `${query.operation} { ${query.resolver.name}${buildQueryArgs(query.args)} ${selection} }`,
    fieldName: query.resolver.name,
    keys
  }
}

// get keys to reuse on merge results
function buildQuerySelection (selection, parent, wrap = true) {
  if (!(selection && selection.length > 0)) {
    return { selection: '', keys: [] }
  }

  const fields = new Set()
  const keys = new Map()
  for (let i = 0; i < selection.length; i++) {
    if (selection[i].field) {
      fields.add(selection[i].field)
    } else if (selection[i].key) {
      fields.add(toQuerySelection(selection[i].key.pkey))
      console.log('TODO keys mush keep the hierachy, parent:', !!parent)
      keys.set('key', selection[i].key)
    } else if (selection[i].selection) {
      // TODO keys? parent?
      fields.add(buildQuerySelection(selection[i].selection, null, selection[i].wrap).selection)
    } else if (selection[i].nested) {
      fields.add(selection[i].parentField)
      for (const nested of selection[i].nested.values()) {
        const s = buildSubQuery(nested.query, nested)
        fields.add(s.subquery)
        // TODO? add type and field name to keys
        // console.log('TODO keys mush keep the hierachy', { parentField: selection[i].parentField })
        // TODO remove OLD keys.push(...s.keys)
        for (const i of Object.keys(s.keys)) {
          const k = s.keys[i]
          // if (keys.has(k.path)) { continue }
          keys.set(k.resolverPath + keyId(k), k)
        }
      }
    } else if (selection[i].deferreds) {
      // add parent keys to merge result after query execution
      for (const deferred of selection[i].deferreds.values()) {
        // src parent type
        const typeName = parent?.field.typeName || deferred.queryNode.field.typeName
        const dkeys = deferredKeys(deferred.keys, typeName)
        for (const dk of dkeys) {
          fields.add(dk)
        }
        // TODO? add field name to keys
        // console.log('TODO keys mush keep the hierachy', parentPath)
        // console.log(' ----------- deferred.keys')
        // console.dir(deferred.keys, { depth: 999 })
        // keys.push(...deferred.keys.map(k => ({ ...k, typeName, path: deferred.path, _debug: 'deferreds' })))
        for (const i of Object.keys(deferred.keys)) {
          const k = deferred.keys[i]
          const p = deferred.resolverPath + keyId(k)
          if (keys.has(p)) { continue }
          keys.set(p, { ...k, typeName, resolverPath: deferred.resolverPath, fieldPath: deferred.fieldPath, _debug: 'deferreds' })
        }
      }
    }
  }

  // console.log(' ----------- keys ---------- ')
  // console.dir(keys)

  const qselection = wrap ? `{ ${Array.from(fields).join(' ')} }` : Array.from(fields).join(' ')
  return { selection: qselection, keys: Array.from(keys.values()) }
}

function keyId (k) {
  if (k.pkey) { return `#pkey.${k.pkey}` }
  if (k.fkey) { return `#fkey.${k.fkey.field}` }
}

function deferredKeys (keys, typeName) {
  return keys.map(k => {
    if (k.fkey) {
      const key = typeName === k.entity ? k.fkey.pkey : k.fkey.field
      // TODO remove old: const key = k.fkey.field ?? k.fkey.pkey
      return toQuerySelection(key)
    }
    if (k.many) {
      console.log(' ************** TODO many')
      return ''
    }

    return toQuerySelection(k.pkey)
  })
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

// TODO faster code
function toQuerySelection (key) {
  return key.split('.').reduce((q, f, i) => {
    return q + (i > 0 ? `{${f}}` : f)
  }, '')
}

function buildSubQuery (query, parent) {
  const s = buildQuerySelection(query.selection, parent)
  return {
    subquery: `${buildQueryArgs(query.args)} ${s.selection}`,
    keys: s.keys
  }
}

// get parent by result
// parent also has result keys
function queryParentResult (query) {
  if (query.root) { return }

  let parent = query.parent
  while (parent) {
    if (parent.root || parent.result) { return parent }
    parent = parent.parent
  }

  return undefined
}

module.exports = {
  createQueryNode,
  createQuery,
  createDeferredQuery,
  addDeferredQueryField,

  queryParentResult,

  buildQuery
}
