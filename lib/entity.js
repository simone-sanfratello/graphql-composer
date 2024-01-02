'use strict'

function entityKeys (field, subgraphName) {
  const keys = []
  if (field.type.entity?.pkey) {
    keys.push({ pkey: field.type.entity.pkey })
  }
  if (field.parent?.entity) {
    if (field.parent?.entity.fkeys.length > 0) {
      // TODO performant code
      const fkeys = field.parent.entity.fkeys
        .filter(k => field.typeName === k.type && subgraphName === k.subgraph)

      keys.push(...fkeys)
    }
  }
  return keys
}

module.exports = {
  entityKeys
}
