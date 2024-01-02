'use strict'
const { deepStrictEqual } = require('node:assert')
const { test } = require('node:test')
const { graphqlRequest, startRouter } = require('./helper')

test('resolves a partial entity from a single subgraph', async (t) => {
  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'])
  const query = `
    query {
      getReviewBook(id: 1) {
        id
        reviews {
          id
          rating
          content
        }
      }
    }
  `
  const data = await graphqlRequest(router, query)

  deepStrictEqual(data, {
    getReviewBook: {
      id: '1',
      reviews: [
        {
          id: '1',
          rating: 2,
          content: 'Would not read again.'
        }
      ]
    }
  })
})

test('resolves an entity across multiple subgraphs', async (t) => {
  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'])

  await t.test('query flows from non-owner to owner subgraph', async (t) => {
    const query = `
      query {
        getReviewBook(id: 1) {
          id
          title
          genre
          reviews {
            id
            rating
            content
          }
        }
      }
    `
    const data = await graphqlRequest(router, query)

    deepStrictEqual(data, {
      getReviewBook: {
        id: '1',
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          }
        ]
      }
    })
  })

  await t.test('query flows from owner to non-owner subgraph', async (t) => {
    const query = `
      query {
        getBook(id: 1) {
          id
          title
          genre
          reviews {
            id
            rating
            content
          }
        }
      }
    `
    const data = await graphqlRequest(router, query)

    deepStrictEqual(data, {
      getBook: {
        id: '1',
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          }
        ]
      }
    })
  })

  await t.test('fetches key fields not in selection set', async (t) => {
    const query = `
      query {
        getReviewBook(id: 1) {
          # id not included and it is part of the keys.
          title
          genre
          reviews {
            id
            rating
            content
          }
        }
      }
    `
    const data = await graphqlRequest(router, query)

    deepStrictEqual(data, {
      getReviewBook: {
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          }
        ]
      }
    })
  })
})

test('Mutations', async () => {
  await test('simple mutation', async (t) => {
    const router = await startRouter(t, ['authors-subgraph'])
    const query = `
      mutation CreateAuthor($author: AuthorInput!) {
        createAuthor(author: $author) {
          id name { firstName lastName }
        }
      }
    `
    const author = { firstName: 'John', lastName: 'Johnson' }
    const data = await graphqlRequest(router, query, { author })

    deepStrictEqual(data, {
      createAuthor: {
        id: '3',
        name: { firstName: 'John', lastName: 'Johnson' }
      }
    })
  })

  await test('simple mutation with input object literal', async (t) => {
    const router = await startRouter(t, ['authors-subgraph'])
    const query = `
      mutation {
        createAuthor(author: { firstName: "Tuco", lastName: "Gustavo" }) {
          id name { firstName lastName }
        }
      }
    `
    const data = await graphqlRequest(router, query)

    deepStrictEqual(data, {
      createAuthor: {
        id: '3',
        name: { firstName: 'Tuco', lastName: 'Gustavo' }
      }
    })
  })

  await test('mutation with input array', async (t) => {
    const router = await startRouter(t, ['authors-subgraph'])
    const query = `
      mutation {
        batchCreateAuthor(authors: [
          { firstName: "Ernesto", lastName: "de la Cruz" },
          { firstName: "Hector", lastName: "Rivera" },
        ]) {
          id name { firstName lastName }
        }
      }
    `
    const data = await graphqlRequest(router, query)

    deepStrictEqual(data, {
      batchCreateAuthor: [{
        id: '3',
        name: { firstName: 'Ernesto', lastName: 'de la Cruz' }
      },
      {
        id: '4',
        name: { firstName: 'Hector', lastName: 'Rivera' }
      }]
    })
  })
})
