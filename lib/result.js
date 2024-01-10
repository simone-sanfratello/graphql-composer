'use strict'

const { copyObjectByKeys } = require('./utils')

function traverseResult (result, path) {
  if (Array.isArray(result)) {
    const r = []
    for (let i = 0; i < result.length; i++) {
      const p = traverseResult(result[i], path)

      if (!p) return
      r[i] = p
    }
    return r
  }

  return result[path]
}

// note: working with references only, do not copy data
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
  let r0
  let i = 1
  while (r0 && i < path.length) {
    r0 = r
    r = traverseResult(r, path[i])
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

function copyResultRow (dst, src, srcIndex, parentKey, path, fillPath) {
  // TODO if srcIndex.list > copy resultS

  if (Array.isArray(dst)) {
    for (let i = 0; i < dst.length; i++) {
      const row = dst[i]
      copyResultRow(row, src, srcIndex, parentKey, fillPath)
    }
    return
  }

  let fillIndex = 0
  for (let i = 0; i < path.length - 1; i++) {
    // check fill path already exists
    if (fillPath[i] === path[i]) { fillIndex = i + 1 }
    dst = dst[path[i]]
  }

  if (!dst?.[parentKey]) { return }
  const rowIndex = srcIndex.map.get(dst[parentKey])
  if (rowIndex === undefined) {
    // TODO if not nullable set "dst" to an empty object
    return
  }

  for (; fillIndex < fillPath.length; fillIndex++) {
    if (!dst[fillPath[fillIndex]]) {
      dst[fillPath[fillIndex]] = {} // TODO get result type from types
    }
    dst = dst[fillPath[fillIndex]]
  }

  // TODO copy only query fields, skip keys: no need to copy key and may replace fields unintentionally
  copyObjectByKeys(dst, src[rowIndex])
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
  mergeResult
}
