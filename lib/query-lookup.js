'use strict'

const { createFieldId } = require('./fields')
const { createQueryNode, createQuery, createDeferredQuery } = require('./query-builder')
const { mergeMaps, collectArgs } = require('./utils')

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
  // TODO if !field err
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

  if (scalar) {
    queries.set(cpath, queryNode)
    return { queries, deferreds }
  }

  const fieldType = field && types[field.typeName]
  for (let i = 0; i < queryFieldSelections.length; ++i) {
    const querySelection = queryFieldSelections[i]
    const selectionFieldName = querySelection.name.value
    const selectionField = getSelectionField(self, fieldType, selectionFieldName)
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
        args: collectArgs(querySelection.arguments, info),
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

    // simple field
    queryNode.query.selection.push({ field: selectionFieldName })
  }

  if (queryNode.query.selection.length > 0) {
    queries.set(cpath, queryNode)
  }

  return { queries, deferreds }
}

function getSelectionField (self, fieldType, selectionFieldName) {
  if (fieldType) {
    if (self) {
      return fieldType
    }

    return fieldType.fields.get(selectionFieldName)
  }
}

module.exports = {
  collectQueries
}
