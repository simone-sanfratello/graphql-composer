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
  let start
  // consider path to start not at the beginning of result
  // TODO write unit tests
  while (i < path.length - 1) {
    const t = traverseResult(r, path[i])
    if (t) {
      if (!start) { start = true }
      r = t
    } else {
      if (start) { break }
    }
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
      // console.log('TODO keys mush keep the hierachy, parent:', !!parent)
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
        for (const i of Object.keys(s.keys)) {
          const k = s.keys[i]
          keys.set(k.resolverPath + keyId(k), k)
        }
      }
    } else if (selection[i].deferreds) {
      // add parent keys for deferred queries, needed to merge results
      // if (!parent) {
      //   console.log('---------------------')
      //   console.dir(selection[i], { depth: 2})
      //   console.log('---------------------')
      // }

      for (const deferred of selection[i].deferreds.values()) {
        // src parent type
        // from nested: parent type
        let parentTypeName = parent?.field.typeName

        console.log(' ========= deferred.type ====', selection[i].type)

        if (!parent) {
          // !! RIGHT
          parentTypeName = deferred.queryNode.parent.field.typeName

          // parentTypeName = deferred.queryNode.parent?.field.typeName ?? deferred.queryNode.field.typeName
          parentTypeName = selection[i].type

          console.log('OK:', parentTypeName)
          console.log('PP:', deferred.queryNode.parent.field.typeName)
          console.log('>>:', deferred.queryNode.field.typeName)
        }

        const dkeys = deferredKeys(deferred.keys, parentTypeName)

        if (!parent) {
          console.log('############################')
          console.dir({
            fields: deferred.fields.map(({ fieldName }) => fieldName),
            deferredQueryNodePath: deferred.queryNode.path,
            typeName: parentTypeName,
            resolverPath: deferred.resolverPath,
            fieldPath: deferred.fieldPath
          }, { depth: 99 })
          console.log(dkeys)
          console.log('############################')
        }

        for (const dk of dkeys) {
          fields.add(dk)
        }

        for (const i of Object.keys(deferred.keys)) {
          const k = deferred.keys[i]
          const p = deferred.resolverPath + keyId(k)
          if (keys.has(p)) { continue }
          keys.set(p, {
            ...k,
            typeName: parentTypeName,
            resolverPath: deferred.resolverPath,
            fieldPath: deferred.fieldPath
          })
        }
      }
    }
  }

  const qselection = wrap ? `{ ${Array.from(fields).join(' ')} }` : Array.from(fields).join(' ')

  console.log('\n\n\nSELECTION:', qselection)

  return { selection: qselection, keys: Array.from(keys.values()) }
}

function buildSubQuery (query, parent) {
  const s = buildQuerySelection(query.selection, parent)
  return {
    subquery: `${buildQueryArgs(query.args)} ${s.selection}`,
    keys: s.keys
  }
}

function keyId (k) {
  if (k.pkey) { return `#pkey.${k.pkey}` }
  if (k.fkey) { return `#fkey.${k.fkey.field}` }
}

function deferredKeys (keys, typeName) {
  return keys.map(k => {
    if (k.fkey) {
      const key = typeName === k.entity ? k.fkey.pkey : k.fkey.field
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
