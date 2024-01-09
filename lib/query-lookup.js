'use strict'

const { createFieldId } = require('./fields')
const { createQueryNode, createQuery, createDeferredQuery, addDeferredQueryField } = require('./query-builder')
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
  types, fields,
  // root: collect root queries
  root,
  // override resolver
  resolver,
  deferred,
  // TODO createcontext({ logger: dummyLogger()})
  context
}) {
  const field = fields[fieldId]
  if (!field) {
    context.logger.error({ fieldId, subgraphName }, 'collectQueries, no field by fieldId')
    throw new Error('Cant collect queries, missing field info')
  }

  const queries = new Map()
  const deferreds = new Map()
  const rootScalar = root && field.src.type.kind === 'SCALAR'

  // TODO fn select query fields
  let queryFieldSelections
  if (rootScalar) {
    queryFieldSelections = [queryFieldNode]
  } else {
    queryFieldSelections = queryFieldNode.selectionSet?.selections
  }

  if (!queryFieldSelections || queryFieldSelections.length < 1) {
    return { queries, deferreds }
  }

  const resolverName = resolver ? resolver.name : queryFieldNode.name?.value
  const cpath = pathJoin(path, queryFieldNode.name?.value)
  const fieldQueryPath = queryPath(cpath, subgraphName)

  const queryNode = createQueryNode({
    subgraphName,
    path,
    field,
    queryFieldNode,
    parent,
    query: createQuery({
      operation: context.info ? context.info.operation.operation : '',
      // TODO createResolver
      resolver: resolver ?? { name: resolverName },
      selection: [],
      args
    })
  })

  // root query for a scalar type is a single query on current subgraph
  if (rootScalar) {
    queries.set(fieldQueryPath, queryNode)
    return { queries, deferreds }
  }

  const fieldType = field && types[field.typeName]
  for (let i = 0; i < queryFieldSelections.length; ++i) {
    const querySelection = queryFieldSelections[i]

    if (querySelection.kind === 'InlineFragment' || querySelection.kind === 'FragmentSpread') {
      const fragment = querySelection.kind === 'FragmentSpread'
        ? context.info.fragments[querySelection.name.value]
        : querySelection

      const nested = collectNestedQueries({
        context,
        fieldId: createFieldId(field.parent.name, field.name),
        subgraphName,
        path: cpath,
        queryNode,
        querySelection: fragment,
        types,
        fields
      })

      // unwrap fragment as selection
      for (const n of nested.queries.values()) {
        queryNode.query.selection.push({ selection: n.query.selection, wrap: false })
      }
      collectDeferredQueries(queryNode, nested, deferreds)

      continue
    }

    // querySelection.kind === 'Field'
    const selectionFieldName = querySelection.name.value

    // meta field, for example `__typename`
    if (selectionFieldName[0] === '_' && selectionFieldName[1] === '_') {
      queryNode.query.selection.push({ field: selectionFieldName })
      continue
    }

    const selectionField = getSelectionField(fieldType, selectionFieldName)
    const nested = querySelection.selectionSet
    const deferred = !selectionField

    if (deferred) {
      if (context.done.includes(fieldQueryPath)) {
        continue
      }

      addDeferredQuery({ deferreds, context, subgraphName, path, queryNode, querySelection, field, selectionFieldName, types, fields })
      continue
    }

    if (nested) {
      const fieldId = createFieldId(field.typeName, selectionFieldName)
      const nested = collectNestedQueries({
        context,
        fieldId,
        subgraphName,
        path: cpath,
        queryNode,
        querySelection,
        types,
        fields
      })

      if (nested.queries.size > 0) {
        queryNode.query.selection.push({ parentField: querySelection.name.value, nested: nested.queries })
      }
      collectDeferredQueries(queryNode, nested, deferreds)
      continue
    }

    // simple field
    queryNode.query.selection.push({ field: selectionFieldName })
  }

  if (queryNode.query.selection.length > 0) {
    context.done.push(fieldQueryPath)
    queries.set(fieldQueryPath, queryNode)
  }

  return { queries, deferreds }
}

function collectNestedQueries ({
  context,
  fieldId,
  subgraphName,
  path,
  queryNode,
  querySelection,
  types,
  fields
}) {
  context.logger.debug({ fieldId, path }, 'query lookup, nested')

  return collectQueries({
    context,
    subgraphName,
    queryFieldNode: querySelection,
    path,
    fieldId,
    parent: queryNode,
    args: collectArgs(querySelection.arguments, context.info),
    types,
    fields
  })
}

function addDeferredQuery ({ deferreds, context, path, queryNode, querySelection, field, selectionFieldName }) {
  const queryPath = pathJoin(path, queryNode.queryFieldNode.name.value, selectionFieldName)

  const deferredParentPath = path + '>' + field.name + '.' + selectionFieldName
  context.logger.debug('query lookup, add deferred query to get: ' + deferredParentPath)
  // since the selection can't be resolved in the current subgraph,
  // gather information to compose and merge the query later

  let deferred = deferreds.get(deferredParentPath)
  if (!deferred) {
    deferred = createDeferredQuery({
      path: queryPath,
      queryNode
    })
    deferreds.set(deferredParentPath, deferred)
  }

  addDeferredQueryField(deferred, selectionFieldName, querySelection)
}

function collectDeferredQueries (queryNode, nested, deferreds) {
  if (nested.deferreds.size < 1) { return }
  mergeMaps(deferreds, nested.deferreds)
  queryNode.query.selection.push({ deferreds: nested.deferreds })
}

function getSelectionField (fieldType, selectionFieldName) {
  if (fieldType) {
    return fieldType.fields.get(selectionFieldName)
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

function queryPath (cpath, subgraphName) {
  return cpath + '#' + subgraphName
}

module.exports = {
  collectQueries,
  collectNestedQueries
}
