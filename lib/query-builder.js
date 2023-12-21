'use strict'

/**
 * @returns {QueryNode}
 */
function createQueryNode ({ subgraphName, parent, field, queryFieldNode, query, followup }) {
  if (followup) {
    return { followup }
  }

  return {
    subgraphName,
    parent,
    field,
    queryFieldNode,
    query
  }
}

function createQuery ({ operation = '', resolver, selection, args }) {
  return { operation, resolver, selection, args }
}

/**
 * @param {QueryNode} parent
 */
function createFollowup ({ fieldName, parent }) {
  return { fieldName, parent }
}

// ---

/**
 * uniforms any result to an array, filters null row
 * @returns array
 */
function toArgsAdapterInput (result) {
  if (!result) { return [] }

  if (!Array.isArray(result)) {
    return [result]
  }

  // TODO flat?
  return result.filter(r => !!r)
}

function buildQuery (query, parent) {
  if (query.resolver.argsAdapter) {
    // TODO resolver.partialResults
    // TODO try-catch, log and so on
    const result = toArgsAdapterInput(parent.result)
    query.args = query.resolver.argsAdapter(result)
  }

  return {
    query: `${query.operation} { ${query.resolver.name}${buildQueryArgs(query.args)} ${buildQuerySelection(query.selection)} }`,
    fieldName: query.resolver.name
  }
}

function buildQuerySelection (selection) {
  if (!(selection && selection.length > 0)) {
    return ''
  }

  const q = []
  for (let i = 0; i < selection.length; i++) {
    if (selection[i].field) {
      q.push(selection[i].field)
    } else if (selection[i].selection) {
      q.push(buildQuerySelection(selection[i].selection))
    } else if (selection[i].queries) {
      // look only for nested fields
      const s = Array.from(selection[i].queries.values())
        .map(q => buildQuerySelection(q.query.selection))
      q.push(s)
    } else if (selection[i].args) {
      // TODO buildQueryArgs
      q.push('TODO build args')
    }
  }

  return `{ ${q.join(' ')} }`
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

// function buildQueryArg (node) {
//   const kind = node.kind

//   if (kind === 'ObjectValue') {
//     const fields = node.fields.map((f) => {
//       const name = f.name.value
//       const value = buildQueryArg(f.value)

//       return `${name}: ${value}`
//     })

//     return `{ ${fields.join(', ')} }`
//   } else if (kind === 'ListValue') {
//     const values = node.values.map(v => buildQueryArg(v))
//     return `[ ${values.join(', ')} ]`
//   } else if (kind === 'StringValue') {
//     return `"${node.value}"`
//   } else {
//     return node.value
//   }
// }

// function queryArgumentsString ({ node, info }) {
//   const length = node.arguments?.length ?? 0

//   if (length === 0) {
//     return ''
//   }

//   const args = node.arguments.map((a) => {
//     const name = a.name.value
//     let value

//     if (a.value.kind === 'Variable') {
//       const varName = a.value.name.value
//       const varValue = info.variableValues[varName]

//       if (typeof varValue === 'object') {
//         const kvs = Object.keys(varValue).map((k) => {
//           let v = varValue[k]

//           if (typeof v === 'string') {
//             v = `"${v}"`
//           }

//           return `${k}: ${v}`
//         }).join(', ')

//         value = `{ ${kvs} }`
//       } else {
//         value = varValue
//       }
//     } else {
//       value = buildQueryArg(a.value)
//     }

//     return `${name}: ${value}`
//   })

//   return `(${args.join(', ')})`
// }

module.exports = {
  createQueryNode,
  createQuery,
  createFollowup,

  buildQuery
}
