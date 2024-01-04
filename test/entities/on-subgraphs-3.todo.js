'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { graphqlRequest, startRouter } = require('./helper')

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
