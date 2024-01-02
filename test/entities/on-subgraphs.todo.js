'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { graphqlRequest, startRouter } = require('./helper')

test('should not involve type keys that are not in the selection', async (t) => {
  const query = `{
      getReviewBookByIds(ids: [1,2,3]) {
        title
        reviews { rating }
      }
    }`

  const expectedResponse = {
    getReviewBookByIds:
      [{
        title: 'A Book About Things That Never Happened',
        reviews: [{ rating: 2 }]
      },
      {
        title: 'A Book About Things That Really Happened',
        reviews: [{ rating: 3 }]
      },
      {
        title: 'Uknown memories',
        reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }]
      }]
  }

  let calls = 0
  const extend = {
    'authors-subgraph': (data) => {
      return {
        schema: `
          input IdsIn {
            in: [ID]!
          }
          input WhereIdsIn {
            ids: IdsIn
          }
   
          extend type Query {
            authors (where: WhereIdsIn): [Author]
          }
          `,
        resolvers: {
          Query: {
            authors: (_, args) => {
              calls++
              return []
            }
          }
        }
      }
    },
    'books-subgraph': (data) => {
      data.library[1].authorId = 1
      data.library[2].authorId = 2
      data.library[3] = {
        id: 3,
        title: 'Uknown memories',
        genre: 'NONFICTION',
        authorId: -1
      }

      return {
        schema: `
            type Author {
              id: ID
            }
            
            extend type Book {
              author: Author
            }
          `,
        resolvers: {
          Book: {
            author: (parent) => {
              calls++
              return { id: null }
            }
          }
        }
      }
    }
  }
  const overrides = {
    subgraphs: {
      'books-subgraph': {
        entities: {
          Book: {
            pkey: 'id',
            fkeys: [{ pkey: 'author.id', type: 'Author' }],
            resolver: {
              name: 'getBooksByIds',
              argsAdapter: (partialResults) => ({ ids: partialResults.map(r => r.id) })
            }
          }
        }
      },
      'authors-subgraph': {
        entities: {
          Author: {
            pkey: 'id',
            resolver: {
              name: 'authors',
              argsAdapter: () => {
                calls++
                return []
              }
            }
          }
        }
      }
    }
  }

  const router = await startRouter(t, ['authors-subgraph', 'books-subgraph', 'reviews-subgraph'], overrides, extend)

  const response = await graphqlRequest(router, query)

  assert.strictEqual(calls, 0)
  assert.deepStrictEqual(response, expectedResponse)
})

test('should run the same query with different args', async (t) => {
  const queries = [
    `{
        getReviewBookByIds(ids: [1]) {
          title
          reviews { rating }
        }
      }`,
    `{
        getReviewBookByIds(ids: [2]) {
          title
          reviews { rating }
        }
      }`
  ]

  const expectedResponses = [{
    getReviewBookByIds: [{
      reviews: [{ rating: 2 }],
      title: 'A Book About Things That Never Happened'
    }]
  },
  {
    getReviewBookByIds: [{
      reviews: [{ rating: 3 }],
      title: 'A Book About Things That Really Happened'
    }]
  }]

  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'])

  for (let i = 0; i < queries.length; i++) {
    const response = await graphqlRequest(router, queries[i])
    assert.deepStrictEqual(response, expectedResponses[i])
  }
})

test('should use multiple subgraphs', async t => {
  const requests = [
    // query multiple services
    {
      query: '{ songs (ids: [1,2,3]) { title, singer { firstName, lastName, profession } } }',
      expected: {
        songs: [
          { title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
          { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko', profession: 'Singer' } },
          { title: 'Vieni via con me', singer: { firstName: 'Roberto', lastName: 'Benigni', profession: 'Director' } }]
      }
    },

    // get all songs by singer
    {
      query: '{ artists (ids: ["103","102"]) { lastName, songs { title } } }',
      expected: {
        artists: [
          { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }] },
          { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] }]
      }
    },

    // query multiple subgraph on the same node
    {
      query: '{ artists (ids: ["103","101","102"]) { lastName, songs { title }, movies { title } } }',
      expected: {
        artists: [
          { lastName: 'Nolan', songs: [], movies: [{ title: 'Interstellar' }, { title: 'Oppenheimer' }] },
          { lastName: 'Benigni', songs: [{ title: 'Vieni via con me' }], movies: [{ title: 'La vita é bella' }] },
          { lastName: 'Molko', songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }], movies: [] }
        ]
      }
    },

    // double nested
    {
      query: '{ artists (ids: ["103"]) { songs { title, singer { firstName, lastName } } } }',
      expected: { artists: [{ songs: [{ title: 'Every you every me', singer: { firstName: 'Brian', lastName: 'Molko' } }, { title: 'The bitter end', singer: { firstName: 'Brian', lastName: 'Molko' } }] }] }
    },

    // nested and nested
    {
      query: '{ artists (ids: ["103"]) { songs { singer { songs { singer { songs { title } }} } } } }',
      expected: { artists: [{ songs: [{ singer: { songs: [{ singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] } }, { singer: { songs: [{ singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }, { singer: { songs: [{ title: 'Every you every me' }, { title: 'The bitter end' }] } }] } }] }] }
    }
  ]

  const info = {
    defaultArgsAdapter: (partialResults) => {
      return { ids: partialResults.map(r => r?.id) }
    }
  }

  const composer = await startRouter(t, ['artists-subgraph-with-entities', 'movies-subgraph-with-entities', 'songs-subgraph-with-entities'], info)

  for (const request of requests) {
    const response = await graphqlRequest(composer, request.query, request.variables)

    assert.deepStrictEqual(response, request.expected, 'should get expected result from composer service,' +
    '\nquery: ' + request.query +
    '\nexpected' + JSON.stringify(request.expected, null, 2) +
    '\nresponse' + JSON.stringify(response, null, 2))
  }
})
