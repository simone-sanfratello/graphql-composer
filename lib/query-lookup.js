'use strict'

const { createFieldId } = require('./fields')
const { createQueryNode, createQuery, createDeferredQuery } = require('./query-builder')
const { mergeMaps } = require('./utils')

/**
 * !important: the "lookup" functions in there:
 * - MUST only gather information to compose queries
 * - MUST NOT contain any logic for deferred/entities or so
 */

/**
 * @typedef CollectedQueries
 * @property {{Map<String, QueryNode>}} queries - the list of query-nodes, identified by path / the path is the map key
 * @property {{Map<String, DeferredQueryNode>}} deferred - the list of deferred query-nodes, identified by path / the path is the map key
 */

/**
 * collect queries to subgraph to resolve a query, starting from the resolver
 * queries can be on the same subgraph, so ready to be executed (when the parent node is complete and the parent result is used as args)
 * or deferred, that means that the query need to be computed to be executed on another subgraph
 * as for now, there's no strategy, queries execution is cascade traversing the request query schema vertically
 *
 * TODO memoize?
 * @returns {CollectedQueries}
 */
function collectQueries ({
  subgraphName, queryFieldNode, path = '', fieldId, parent, args,
  // references
  types, fields, info,
  // root: collect root queries
  root,
  // self: resolve field by fieldId instead of subselection - for deferred queries
  self,
  // override resolver
  resolver
}) {
  const field = fields[fieldId]
  const scalar = root && field.src.type.kind === 'SCALAR'

  // TODO fn select query fields
  let queryFieldSelections
  if (self || scalar) {
    queryFieldSelections = [queryFieldNode]
  } else {
    queryFieldSelections = queryFieldNode.selectionSet?.selections
  }

  if (!queryFieldSelections || queryFieldSelections.length < 1) {
    return { queries: new Map(), deferreds: new Map() }
  }

  // TODO if !field err
  const fieldType = field && types[field.typeName]
  const resolverName = resolver ? resolver.name : queryFieldNode.name.value

  const cpath = path ? path + '.' + field.name : field.name
  const queries = new Map()
  const deferreds = new Map()

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
      selection: [],
      args
    })
  })

  for (let i = 0; i < queryFieldSelections.length; ++i) {
    const querySelection = queryFieldSelections[i]
    const selectionFieldName = querySelection.name.value
    const selectionField = getSelectionField(self, fieldType, selectionFieldName, scalar)
    const deferred = !selectionField
    const nested = querySelection.selectionSet

    // TODO fragments

    if (deferred) {
      // since the selection can't be resolved in the current subgraph,
      // gather information to compose and merge the query later
      deferreds.set(cpath + '>' + selectionFieldName, createDeferredQuery({
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
    if (!scalar) {
      queryNode.query.selection.push({ field: selectionFieldName })
    }
  }

  if (scalar || queryNode.query.selection.length > 0) {
    queries.set(cpath, queryNode)
  }

  return { queries, deferreds }
}

function getSelectionField (self, fieldType, selectionFieldName, scalar) {
  if (fieldType) {
    if (self || scalar) {
      return fieldType
    }

    return fieldType.fields.get(selectionFieldName)
  }
}

// const selectionField = fieldType ? (self ? fieldType : fieldType.fields.get(selectionFieldName)) : undefined

module.exports = {
  collectQueries
}
