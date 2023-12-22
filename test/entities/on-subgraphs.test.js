'use strict'

'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const pino = require('pino')

const { createComposerService, createGraphqlServices, graphqlRequest } = require('../helper')
const { compose } = require('../../lib')

const authorsSubgraph = () => {
  const schema = `
    input IdsIn {
      in: [ID]!
    }
    input WhereIdsIn {
      ids: IdsIn
    }

    input AuthorInput {
      firstName: String!
      lastName: String!
    }
  
    type AuthorTodo {
      task: String
    }
  
    type AuthorName {
      firstName: String
      lastName: String
    }
  
    type Author {
      id: ID
      name: AuthorName
      todos(id: ID!): [AuthorTodo]
    }
  
    type BlogPostPublishEvent {
      authorId: ID!
    }
  
    type Query {
      get(id: ID!): Author
      list: [Author]
      authors (where: WhereIdsIn): [Author]
    }
  
    type Mutation {
      createAuthor(author: AuthorInput!): Author!
      batchCreateAuthor(authors: [AuthorInput]!): [Author]!
      publishBlogPost(authorId: ID!): Boolean!
    }
  `

  const data = {
    authors: null,
    todos: null
  }

  function reset () {
    data.authors = {
      1: {
        id: 1,
        name: {
          firstName: 'Peter',
          lastName: 'Pluck'
        }
      },
      2: {
        id: 2,
        name: {
          firstName: 'John',
          lastName: 'Writer'
        }
      },
      10: {
        id: 10,
        name: {
          firstName: 'John Jr.',
          lastName: 'Johnson'
        }
      },
      11: {
        id: 11,
        name: {
          firstName: 'Cindy',
          lastName: 'Connor'
        }
      }
    }

    data.todos = {
      1: {
        id: 1,
        authorId: 1,
        task: 'Write another book'
      },
      2: {
        id: 2,
        authorId: 1,
        task: 'Get really creative'
      }
    }
  }

  reset()

  const resolvers = {
    Query: {
      get (_, { id }) {
        return data.authors[id]
      },
      list () {
        return Object.values(data.authors)
      },
      authors (_, args) {
        return Object.values(data.authors).filter(a => args.where.ids.in.includes(String(a.id)))
      }
    },
    Mutation: {
      async createAuthor (_, { author: authorInput }) {
        const id = Object.keys(data.authors).length + 1
        const author = {
          id,
          name: { ...authorInput }
        }

        data.authors[id] = author
        return author
      },

      async batchCreateAuthor (_, { authors: authorsInput }) {
        const created = []
        for (const authorInput of authorsInput) {
          const id = Object.keys(data.authors).length + 1
          const author = {
            id,
            name: { ...authorInput }
          }

          data.authors[id] = author
          created.push(author)
        }
        return created
      },

      async publishBlogPost (_, { authorId }, context) {
        context.app.graphql.pubsub.publish({
          topic: 'PUBLISH_BLOG_POST',
          payload: {
            postPublished: {
              authorId
            }
          }
        })

        return true
      }
    },
    Author: {
      async todos (_, { id }) {
        return Object.values(data.todos).filter((t) => {
          return String(t.id) === id
        })
      }
    }
  }

  const entities = {
    Author: {
      pkey: 'id',
      resolver: {
        name: 'authors',
        argsAdapter: (partialResults) => ({ where: { ids: { in: partialResults.map(r => r.id) } } })
      }
    }
  }

  return { schema, resolvers, entities, data, reset }
}

const booksSubgraph = () => {
  const schema = `
  enum BookGenre {
    FICTION
    NONFICTION
  }

  type Book {
    id: ID!
    title: String
    genre: BookGenre
    author: Author
  }

  type Author {
    id: ID
  }
  
  type Query {
    getBook(id: ID!): Book
    getBookTitle(id: ID!): String
    getBooksByIds(ids: [ID]!): [Book]!
    booksByAuthors(authorIds: [ID!]!): [Book]
  }
`
  const data = { library: null }

  function reset () {
    data.library = {
      1: {
        id: 1,
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        authorId: 10
      },
      2: {
        id: 2,
        title: 'A Book About Things That Really Happened',
        genre: 'NONFICTION',
        authorId: 10
      },
      3: {
        id: 3,
        title: 'From the universe',
        genre: 'FICTION',
        authorId: 11
      },
      4: {
        id: 4,
        title: 'From another world',
        genre: 'FICTION',
        authorId: 11
      }
    }
  }

  reset()

  const resolvers = {
    Query: {
      async getBook (_, { id }) {
        return data.library[id]
      },
      async getBookTitle (_, { id }) {
        return data.library[id]?.title
      },
      async getBooksByIds (_, { ids }) {
        return ids
          .map((id) => { return data.library[id] })
          .filter(b => !!b)
      },
      booksByAuthors: (parent, { authorIds }) => Object.values(data.library).filter(book => authorIds.includes(String(book.authorId)))
    },
    Book: {
      author: (parent) => ({ id: parent.authorId || data.library[parent.id]?.authorId })
    }
  }
  const entities = {
    Book: {
      pkey: 'id',
      fkeys: [{ pkey: 'author.id', type: 'Author' }],
      resolver: {
        name: 'getBooksByIds',
        argsAdapter: (partialResults) => ({ ids: partialResults.map(r => r.id) })
      }
    }
  }

  return { schema, resolvers, entities, data, reset }
}

test('should resolve foreign types referenced in different results', {only:true}, async (t) => {
  const query = `{
    booksByAuthors(authorIds: [10, 11, 12]) {
      title author { name { firstName, lastName } }
    }
  }`

  const expectedResult = {
    booksByAuthors: [
      { title: 'A Book About Things That Never Happened', author: { name: { firstName: 'John Jr.', lastName: 'Johnson' } } },
      { title: 'A Book About Things That Really Happened', author: { name: { firstName: 'John Jr.', lastName: 'Johnson' } } },
      { title: 'From the universe', author: { name: { firstName: 'Cindy', lastName: 'Connor' } } },
      { title: 'From another world', author: { name: { firstName: 'Cindy', lastName: 'Connor' } } }
    ]
  }

  const books = booksSubgraph()
  const authors = authorsSubgraph()

  const services = await createGraphqlServices(t, [
    {
      name: 'books-subgraph',
      mercurius: {
        schema: books.schema,
        resolvers: books.resolvers
      },
      entities: books.entities,
      listen: true
    },
    {
      name: 'authors-subgraph',
      mercurius: {
        schema: authors.schema,
        resolvers: authors.resolvers
      },
      entities: authors.entities,
      listen: true
    }
  ])

  const options = {
    logger: pino({ level: 'debug' }),
    subgraphs: services.map(service => ({
      name: service.name,
      server: { host: service.host },
      entities: service.config.entities
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})
