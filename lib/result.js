'use strict'

const { copyObjectByKeys } = require('./utils')

function traverseResult (result, path) {
  if (Array.isArray(result)) {
    const r = []
    for (let i = 0; i < result.length; i++) {
      const p = traverseResult(result[i], path)

      if (p === undefined) return
      r[i] = p
    }
    return r
  }

  return result[path]
}

// important: working with references only, do not copy data
function mergeResult (result, fullPath, queryNode, parentResult) {
  const path = fullPath.split('.')
  const partial = queryNode.result

  if (path.length === 1 && result[fullPath] === undefined) {
    // root
    result[fullPath] = partial
    return
  }

  // traverse result till bottom
  let r = result[path[0]]
  let i = 1
  while (i < path.length) {
    const t = traverseResult(r, path[i])
    if (!t) { break }
    r = t
    i++
  }

  // fill the missing result path
  // TODO add here "as" or mapping entities
  const fillPath = []
  for (let j = i; j < path.length; j++) {
    fillPath.push(path[j])
  }

  if (!r) {
    // copy reference
    r = partial
    return
  }

  const key = parentResult.keys.self
  const parentKey = parentResult.keys.parent
  const index = resultIndex(partial, key)

  // TODO get result type from query node
  if (Array.isArray(r)) {
    for (let i = 0; i < r.length; i++) {
      copyResultRow(r[i], partial, index, parentKey, parentResult.path, fillPath)
    }
    return
  }

  // r is an object
  copyResultRow(r, partial, index, parentKey, parentResult.path, fillPath)
}

function copyResultRow (dst, src, srcIndex, parentKey, keyPath, fillPath) {
  // TODO if srcIndex.list > copy resultS

  let traverseDst = dst

  if (Array.isArray(traverseDst)) {
    for (let i = 0; i < traverseDst.length; i++) {
      const row = traverseDst[i]
      copyResultRow(row, src, srcIndex, parentKey, keyPath, fillPath)
    }
    return
  }

  let fillIndex = 0

  if (!traverseDst?.[parentKey]) { return } // TODO !undefined !null
  const rowIndex = srcIndex.map.get(traverseDst[parentKey])
  if (rowIndex === undefined) {
    // TODO if not nullable set "dst" to an empty object
    return
  }

  for (; fillIndex < fillPath.length; fillIndex++) {
    if (!traverseDst[fillPath[fillIndex]]) {
      traverseDst[fillPath[fillIndex]] = {} // TODO get result type from types
    }
    traverseDst = traverseDst[fillPath[fillIndex]]
  }

  copyObjectByKeys(traverseDst, src[rowIndex])
}

function resultIndex (result, key) {
  if (result.length < 1) {
    return { list: false, map: new Map() }
  }
  const list = Array.isArray(result[0][key])
  const index = new Map()

  if (list) {
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result[i][key].length; j++) {
        const s = index.get(result[i][key][j])
        if (s) {
          index.set(result[i][key][j], s.concat(i))
          continue
        }
        index.set(result[i][key][j], [i])
      }
    }
  } else {
    for (let i = 0; i < result.length; i++) {
      index.set(result[i][key], i)
    }
  }

  return { list, map: index }
}

module.exports = {
  traverseResult,
  mergeResult,
  copyResultRow
}
