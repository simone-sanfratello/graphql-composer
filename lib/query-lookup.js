'use strict'

const { createFieldId } = require('./fields')
const { createQueryNode, createQuery, createDeferredQuery, addDeferredQueryField } = require('./query-builder')
const { mergeMaps, collectArgs, dummyLogger } = require('./utils')

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
  resolver,
  logger = dummyLogger()
}) {
  const deferreds = new Map()
  const field = fields[fieldId]
  if (!field) {
    console.log('\n\n\n\n****************NO FIELD', fieldId, subgraphName)

    // TODO
    // addDeferredQuery({
    //   deferreds,
    //   subgraphName,
    //   path,

    //   ///
    //   // queryNode,
    //   // querySelection,
    //   // field,
    //   // selectionFieldName,
    //   ///

    //   self,
    //   types,
    //   fields,
    //   info,
    //   logger
    // })

    return { queries: new Map(), deferreds }
  }

  const rootScalar = root && field.src.type.kind === 'SCALAR'

  // TODO fn select query fields
  let queryFieldSelections
  if (self || rootScalar) {
    queryFieldSelections = [queryFieldNode]
  } else {
    queryFieldSelections = queryFieldNode.selectionSet?.selections
  }

  if (!queryFieldSelections || queryFieldSelections.length < 1) {
    return { queries: new Map(), deferreds: new Map() }
  }

  const resolverName = resolver ? resolver.name : queryFieldNode.name?.value
  const cpath = pathJoin(path, field.name)
  const queries = new Map()

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

  // root query for a scalar type is a single query on current subgraph
  if (rootScalar) {
    queries.set(cpath, queryNode)
    return { queries, deferreds }
  }

  const fieldType = field && types[field.typeName]
  for (let i = 0; i < queryFieldSelections.length; ++i) {
    const querySelection = queryFieldSelections[i]

    if (querySelection.kind === 'InlineFragment' || querySelection.kind === 'FragmentSpread') {
      const fragment = querySelection.kind === 'FragmentSpread'
        ? info.fragments[querySelection.name.value]
        : querySelection

      const nested = collectNestedQueries({
        deferreds,
        fieldId: createFieldId(field.parent.name, field.name),
        subgraphName,
        path: cpath,
        queryNode,
        querySelection: fragment,
        info,
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

    const selectionField = getSelectionField(self, fieldType, selectionFieldName)
    const nested = querySelection.selectionSet
    const deferred = !selectionField

    if (deferred) {
      addDeferredQuery({ deferreds, subgraphName, path, queryNode, querySelection, field, selectionFieldName, self, types, fields, info, logger })
      continue
    }

    if (nested) {
      const fieldId = createFieldId(self ? field.parent.name : field.typeName, selectionFieldName)
      logger.debug({ fieldId }, 'query lookup, nested')
      const nested = collectNestedQueries({
        deferreds,
        fieldId,
        subgraphName,
        path: cpath,
        queryNode,
        querySelection,
        info,
        types,
        fields,
        logger
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
    queries.set(cpath, queryNode)
  }

  return { queries, deferreds }
}

function collectNestedQueries ({
  fieldId,
  subgraphName,
  path,
  queryNode,
  querySelection,
  info,
  types,
  fields,
  logger
}) {
  return collectQueries({
    subgraphName,
    queryFieldNode: querySelection,
    path,
    fieldId,
    parent: queryNode,
    args: collectArgs(querySelection.arguments, info),
    types,
    fields,
    logger
  })
}

function addDeferredQuery ({ deferreds, subgraphName, path, queryNode, querySelection, field, selectionFieldName, self, types, fields, info, logger }) {
  const deferredParentPath = path + '>' + field.name
  logger.debug('query lookup, add deferred query to get: ' + deferredParentPath)
  // since the selection can't be resolved in the current subgraph,
  // gather information to compose and merge the query later

  let deferred = deferreds.get(deferredParentPath)
  if (!deferred) {
    deferred = createDeferredQuery({
      path: pathJoin(path, field.name, selectionFieldName),
      parent: queryNode
    })
    deferreds.set(deferredParentPath, deferred)
  }

  if (querySelection.selectionSet) {
    const fieldId = createFieldId(self ? field.parent.name : field.typeName, selectionFieldName)
    const nested = collectNestedQueries({
      deferreds,
      fieldId,
      subgraphName,
      path: pathJoin(path, field.name, selectionFieldName),
      queryNode,
      querySelection,
      info,
      types,
      fields
    })

    addDeferredQueryField(deferred, selectionFieldName, querySelection, nested.queries.values())
    collectDeferredQueries(queryNode, nested, deferreds)
  } else {
    addDeferredQueryField(deferred, selectionFieldName, querySelection)
  }
}

function collectDeferredQueries (queryNode, nested, deferreds) {
  if (nested.deferreds.size < 1) { return }
  mergeMaps(deferreds, nested.deferreds)
  queryNode.query.selection.push({ deferreds: nested.deferreds })
}

function getSelectionField (self, fieldType, selectionFieldName) {
  if (fieldType) {
    if (self) {
      return fieldType
    }

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

module.exports = {
  collectQueries,
  collectNestedQueries
}
