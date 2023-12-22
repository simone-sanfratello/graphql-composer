'use strict'

const { copyObjectByKeys } = require('./utils')

function traverseResult (result, path) {
  if (Array.isArray(result)) {
    return result.map(r => traverseResult(r, path))
  }
  return result[path]
}

// note: working with references
function mergeResult (result, fullPath, queryNode) {
  const path = fullPath.split('.')
  const partial = queryNode.result

  if (path.length === 1) {
    // root
    result[fullPath] = partial
    return
  }

  let r = result[path[0]]
  for (let i = 1; i < path.length - 1; i++) {
    r = traverseResult(r, path[i])
  }

  if (!r) {
    // copy reference
    r = partial
    return
  }

  // NOTE! field.parent and parent.field
  // field and type have a different structure
  const key = queryNode.field.parent.entity.pkey
  const parentKey = queryNode.parent.field.type.entity.pkey
  const index = resultIndex(partial, key)

  // TODO get result type from query node
  if (Array.isArray(r)) {
    for (let i = 0; i < r.length; i++) {
      copyResultRow(r[i], partial, index, parentKey)
    }
    return
  }

  // r is an object
  copyResultRow(r, partial, index, parentKey)
}

function copyResultRow (dst, src, srcIndex, key) {
  // TODO if srcIndex.list > copy resultS

  if (Array.isArray(dst)) {
    for (let i = 0; i < dst.length; i++) {
      const row = dst[i]
      copyResultRow(row, src, srcIndex, key)
    }
    return
  }

  const rowIndex = srcIndex.map.get(dst[key])
  if (rowIndex === undefined) {
    // TODO if not nullable set "dst" to an empty object
    return
  }

  // TODO copy only query fields, skip keys: no need to copy key and may replace fields unintentionally
  copyObjectByKeys(dst, src[rowIndex])
}

function resultIndex (result, key) {
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
