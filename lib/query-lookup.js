'use strict'

const { createQueryNode, createQuery, createFollowup } = require('./query-builder')

// MUST only gather information
// MUST NOT contain followup/entities logic
// TODO memoize?
function collectQueries ({ subgraphName, queryFieldNode, field, types, info, args, path = '' }) {
  const querySelections = queryFieldNode.selectionSet?.selections

  if (!querySelections || querySelections.length < 1) {
    return new Map()
  }

  const fieldType = types[field.typeName]
  const resolverName = queryFieldNode.name.value

  // TODO queries as a tree, append followups on parent node
  const queryNode = createQueryNode({
    // TODO parent ?
    subgraphName,
    field,
    queryFieldNode,
    query: createQuery({
      operation: info ? info.operation.operation : '',
      // TODO createResolver
      resolver: { name: resolverName },
      selection: [],
      args
    })
  })
  const cpath = path ? path + '.' + field.name : field.name
  const queries = new Map()
  queries.set(cpath, queryNode)

  for (let i = 0; i < querySelections.length; ++i) {
    const querySelection = querySelections[i]
    const selectionFieldName = querySelection.name.value
    const selectionField = fieldType ? fieldType.fields.get(selectionFieldName) : undefined

    // TODO fragments

    if (!selectionField) {
      // since the selection can't be resolved in the current subgraph,
      // gather information to compose and merge the query later
      queries.set(cpath + '.' + selectionFieldName, {
        followup: createFollowup({
          fieldName: selectionFieldName,
          parent: queryNode
        })
      })
      continue
    }

    queryNode.query.selection.push({ field: selectionFieldName })

    // nested type, on same subgraph
    if (querySelection.arguments.length > 0) {
      // TODO should return a struct instead of the string, values will be add later
      queryNode.query.selection.push({ args: 'TODO getArguments(querySelection)' })
    }

    if (querySelection.selectionSet) {
      // TODO this should go as > queries.nested (or so) push(queries)
      queryNode.query.selection.push({
        queries: collectQueries({
          subgraphName,
          queryFieldNode: querySelection,
          field: selectionField,
          // TODO ? args: querySelection.arguments
          types,
          path: cpath
        })
      })
    }
  }

  return queries
}

module.exports = {
  collectQueries
}
