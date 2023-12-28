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
function mergeResult (result, fullPath, entityKey, queryNode) {
  const path = fullPath.split('.')
  const partial = queryNode.result

  if (path.length === 1) {
    // root
    result[fullPath] = partial
    return
  }

  // traverse result till bottom
  let r = result[path[0]]
  let r0
  let i = 1
  while (r0 && i < path.length - 1) {
    r0 = r
    r = traverseResult(r, path[i])
    i++
  }

  // get the missing result path
  // const resultPath = []
  // for (let j = i; j < path.length - 1; j++) {
  //   resultPath.push(path[j])
  // }

  if (!r) {
    // copy reference
    r = partial
    return
  }

  // field and type have a different structure
  const key = queryNode.field.parent.entity.pkey
  // TODO fn keyFromPath
  // NOTE! field.parent and parent.field
  const parentKeyPath = entityKey.split('.')
  const parentKey = parentKeyPath.at(-1)
  const index = resultIndex(partial, key)

  // TODO get result type from query node
  if (Array.isArray(r)) {
    for (let i = 0; i < r.length; i++) {
      copyResultRow(r[i], partial, parentKeyPath, index, parentKey)
    }
    return
  }

  // r is an object
  copyResultRow(r, partial, parentKeyPath, index, parentKey)
}

function copyResultRow (dst, src, path, srcIndex, key) {
  // TODO if srcIndex.list > copy resultS

  if (Array.isArray(dst)) {
    for (let i = 0; i < dst.length; i++) {
      const row = dst[i]
      copyResultRow(row, src, path, srcIndex, key)
    }
    return
  }

  for (let i = 0; i < path.length - 1; i++) {
    dst = dst[path[i]]
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
