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
    query,
    result: undefined,
    keys: []
  }
}

function createQuery ({ operation = '', resolver, selection, args }) {
  return { operation, resolver, selection, args }
}

/**
 * @param {QueryNode} parent
 */
function createDeferredQuery ({ fieldName, queryFieldNode, parent, path }) {
  return { fieldName, queryFieldNode, parent, path, entity: undefined, keys: undefined, subgraphName: undefined }
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

function buildQuery (query, parentResult) {
  const { selection, keys } = buildQuerySelection(query.selection)

  if (query.resolver?.argsAdapter) {
    // TODO resolver.partialResults
    // TODO try-catch, log and so on
    const r = toArgsAdapterInput(parentResult.data, parentResult.path)
    // TODO filter duplicates in toArgsAdapterInput
    query.args = query.resolver.argsAdapter(r)
  }

  return {
    query: `${query.operation} { ${query.resolver.name}${buildQueryArgs(query.args)} ${selection} }`,
    fieldName: query.resolver.name,
    keys
  }
}

// get keys to reuse on merge results
function buildQuerySelection (selection, wrap = true) {
  if (!(selection && selection.length > 0)) {
    return { selection: '', keys: [] }
  }

  const fields = new Set()
  const keys = []
  for (let i = 0; i < selection.length; i++) {
    if (selection[i].field) {
      fields.add(selection[i].field)
    } else if (selection[i].key) {
      fields.add(toQuerySelection(selection[i].key.pkey))
    } else if (selection[i].selection) {
      // TODO keys?
      fields.add(buildQuerySelection(selection[i].selection, selection[i].wrap).selection)
    } else if (selection[i].nested) {
      fields.add(selection[i].parentField)
      for (const nested of selection[i].nested.values()) {
        // TODO keys?
        fields.add(buildSubQuery(nested.query))
      }
    } else if (selection[i].deferreds) {
      // add parent keys to merge result after query execution
      for (const deferred of selection[i].deferreds.values()) {
        // TODO optimization: add key by deferred query: add fkeys/many keys only when needed
        fields.add(...deferred.keys.map(k => toQuerySelection(k.pkey)))
        keys.push(...deferred.keys)
      }
    }
  }

  const qselection = wrap ? `{ ${Array.from(fields).join(' ')} }` : Array.from(fields).join(' ')
  return { selection: qselection, keys }
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

function buildSubQuery (query) {
  return `${buildQueryArgs(query.args)} ${buildQuerySelection(query.selection).selection}`
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
