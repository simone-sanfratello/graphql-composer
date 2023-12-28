'use strict'

const { createFieldId } = require('./fields')
const { createQueryNode, createQuery, createDeferredQuery } = require('./query-builder')
const { mergeMaps } = require('./utils')

/**
 * @typedef CollectedQueries
 * @property {{Map<String, QueryNode>}} queries - the list of query-nodes, identified by path / the path is the map key
 * @property {{Map<String, DeferredQueryNode>}} deferred - the list of deferred query-nodes, identified by path / the path is the map key
 */

/**
 * collect queries to subgraph to resolve a query, starting from the resolver
 * MUST only gather information to compose queries
 * MUST NOT contain any logic for deferred/entities or so
 * TODO memoize?
 * @returns {CollectedQueries}
 */
function collectQueries ({
  subgraphName, queryFieldNode, path = '', fieldId, parent, args,
  // references
  types, fields, info,
  // TODO root? query for current node instead of subfields
  self,
  // override or inject node info
  resolver, selection
}) {
  const queryFieldSelections = self ? [queryFieldNode] : queryFieldNode.selectionSet?.selections

  if (!queryFieldSelections || queryFieldSelections.length < 1) {
    return { queries: new Map(), deferreds: new Map() }
  }

  const field = fields[fieldId]
  // TODO if !field err
  const fieldType = field && types[field.typeName]
  const resolverName = resolver ? resolver.name : queryFieldNode.name.value

  const cpath = path ? path + '.' + field.name : field.name
  const queries = new Map()
  const deferreds = new Map()

  // TODO queries as a tree
  const queryNode = createQueryNode({
    subgraphName,
    path,
    field,
    queryFieldNode,
    parent,
    query: createQuery({
      operation: info ? info.operation.operation : '',
      // TODO createResolver
      resolver: resolver ?? { name: resolverName },
      selection: selection ?? [],
      args
    })
  })

  for (let i = 0; i < queryFieldSelections.length; ++i) {
    const querySelection = queryFieldSelections[i]
    const selectionFieldName = querySelection.name.value
    // TODO use a fn, hard to read
    const selectionField = fieldType ? (self ? fieldType : fieldType.fields.get(selectionFieldName)) : undefined
    const deferred = !selectionField
    const nested = querySelection.selectionSet

    // TODO fragments

    if (deferred) {
      // since the selection can't be resolved in the current subgraph,
      // gather information to compose and merge the query later
      deferreds.set(cpath, createDeferredQuery({
        // parentField: querySelection.name.value,
        fieldName: selectionFieldName,
        path: cpath,
        queryFieldNode: querySelection,
        parent: queryNode
      }))
      continue
    }

    if (nested) {
      const fieldId = createFieldId(self ? field.parent.name : field.typeName, selectionFieldName)
      const nested = collectQueries({
        subgraphName,
        queryFieldNode: querySelection,
        path: cpath,
        fieldId,
        parent: queryNode,
        // TODO ? args: querySelection.arguments
        types,
        fields
      })

      if (nested.queries.size > 0) {
        queryNode.query.selection.push({ parentField: querySelection.name.value, nested: nested.queries })
      }

      if (nested.deferreds.size > 0) {
        mergeMaps(deferreds, nested.deferreds)
        queryNode.query.selection.push({ deferreds: nested.deferreds })
      }
      continue
    }

    // selection with args
    if (querySelection.arguments.length > 0) {
      // TODO should return a struct instead of the string, values will be add later
      // queryNode.query.selection.push({ args: 'TODO getArguments(querySelection)' })
    }

    // simple field
    queryNode.query.selection.push({ field: selectionFieldName })
  }

  if (queryNode.query.selection.length > 0) {
    queries.set(cpath, queryNode)
  }

  return { queries, deferreds }
}

module.exports = {
  collectQueries
}
