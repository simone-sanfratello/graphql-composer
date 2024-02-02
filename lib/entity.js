'use strict'

// TODO memoize
function entityKeys ({ field, subgraph, entity }) {
  const keys = []

  // entity pkey
  if (field.type.entity) {
    if (field.type.entity.pkey) {
      keys.push({ pkey: field.type.entity.pkey })
    }
    if (field.type.entity.fkeys && field.type.entity.fkeys.length > 0) {
      for (const fkey of field.type.entity.fkeys) {
        if (fkey.as) {
          keys.push({ fkey: fkey.field, as: fkey.as })
        }
      }
    }
    if (field.type.entity.many && field.type.entity.many.length > 0) {
      for (const many of field.type.entity.many) {
        if (many.as && (!subgraph || subgraph === many.subgraph)) {
          keys.push({ many: many.fkey, as: many.as })
        }
      }
    }
  }

  // parent keys
  if (field.parent?.entity) {
    if (field.parent?.entity.fkeys.length > 0) {
      for (let i = 0; i < field.parent.entity.fkeys.length; i++) {
        const key = field.parent.entity.fkeys[i]
        if (field.typeName === key.type && (!subgraph || subgraph === key.subgraph)) {
          keys.push({ fkey: key, entity })
        }
      }
    }
    if (field.parent?.entity.many.length > 0) {
      console.log(' ************** TODO many')
    }
  }

  return keys
}

module.exports = {
  entityKeys
}
