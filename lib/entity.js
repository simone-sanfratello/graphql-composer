'use strict'

function entityKeys (field, subgraphName) {
  const keys = []
  if (field.type.entity?.pkey) {
    keys.push({ pkey: field.type.entity.pkey })
  }
  if (field.parent?.entity) {
    if (field.parent?.entity.fkeys.length > 0) {
      for (let i = 0; i < field.parent.entity.fkeys.length; i++) {
        const key = field.parent.entity.fkeys[i]
        if (field.typeName === key.type && (!subgraphName || (subgraphName && subgraphName === key.subgraph))) {
          keys.push({ fkey: key })
        }
      }
      // TODO many
    }
  }
  return keys
}

module.exports = {
  entityKeys
}
