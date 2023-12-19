'use strict'

const { valueToArgumentString } = require('./graphql-utils')
const { toQuerySelection } = require('./utils')

function collectQueries ({
  // composer info
  types, subgraphs,
  // resolver generator
  typeName, subgraphName, field,
  // resolver args
  parent, args, context, info
}) {
  const operation = info.operation.operation
  const resolverName = field.name // or else

  const queries = []
  for (const queryField of info.fieldNodes) {
    const q = buildQuery({
      queryField,
      field,
      types,
      info
    })

    queries.push({
      resolverName,
      subgraphName, // from buildQuery?
      query: `${operation} { ${resolverName}${q.args} ${toQuerySelection(q.selection)} }`
    })
  }

  return queries
}

function buildQuery ({ queryField, field, types, info }) {
  return {
    selection: buildSelection({ queryField, field, types }),
    args: buildArguments({ queryField, info })
  }
}

function buildSelection ({ queryField, field, types }) {
  const querySelections = queryField.selectionSet?.selections

  if (!querySelections || querySelections.length < 1) {
    return []
  }

  const selection = new Set()
  for (let i = 0; i < querySelections.length; ++i) {
    const querySelection = querySelections[i]
    const fieldName = [querySelection.name.value]
    // const fieldInfo = field // selection info

    // TODO fragments

    // TODO nested
    // if (fieldInfo) {
    //   if (querySelection.arguments.length > 0) {
    //     fieldName.push(buildArguments(querySelection))
    //   }

    //   if (querySelection.selectionSet) {
    //     fieldName.push(buildSelectionSet({ queryField: querySelection, field: fieldInfo, types }))
    //   }
    // }

    selection.add(fieldName)
  }

  return Array.from(selection)
}

function buildArguments ({ queryField, info }) {
  const length = queryField.arguments?.length ?? 0

  if (length === 0) {
    return ''
  }

  const args = queryField.arguments.map((a) => {
    const name = a.name.value
    let value

    if (a.value.kind === 'Variable') {
      const varName = a.value.name.value
      const varValue = info.variableValues[varName]

      if (typeof varValue === 'object') {
        const kvs = Object.keys(varValue).map((k) => {
          let v = varValue[k]

          if (typeof v === 'string') {
            v = `"${v}"`
          }

          return `${k}: ${v}`
        }).join(', ')

        value = `{ ${kvs} }`
      } else {
        value = varValue
      }
    } else {
      value = valueToArgumentString(a.value)
    }

    return `${name}: ${value}`
  })

  return `(${args.join(', ')})`
}

module.exports = {
  collectQueries
}
