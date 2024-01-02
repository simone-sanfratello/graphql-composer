'use strict'

'use strict'

const assert = require('node:assert')
const { test } = require('node:test')

const { createComposerService, createGraphqlServices, graphqlRequest } = require('../helper')
const { compose } = require('../../lib')

const booksSubgraph = () => {
  const schema = `
  enum BookGenre {
    FICTION
    NONFICTION
  }

  type Author {
    id: ID
  }

  type Book {
    id: ID!
    title: String
    genre: BookGenre
    author: Author
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
        title: 'Watering the plants',
        genre: 'NONFICTION',
        authorId: 11
      },
      4: {
        id: 4,
        title: 'Pruning the branches',
        genre: 'NONFICTION',
        authorId: 11
      }
    }
  }

  reset()

  const resolvers = {
    Book: {
      author: (parent) => ({ id: parent.authorId || data.library[parent.id]?.authorId })
    },
    Query: {
      getBook (_, { id }) {
        return data.library[id]
      },
      getBookTitle (_, { id }) {
        return data.library[id]?.title
      },
      getBooksByIds (_, { ids }) {
        return ids
          .map((id) => { return data.library[id] })
          .filter(b => !!b)
      },
      booksByAuthors: (parent, { authorIds }) => Object.values(data.library).filter(book => authorIds.includes(String(book.authorId)))
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

const authorsSubgraph = () => {
  const schema = `
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
    books: [Book]
  }

  type BlogPostPublishEvent {
    authorId: ID!
  }

  type Query {
    get(id: ID!): Author
    list: [Author]
    authors (where: WhereIdsIn): [Author]
  }

  input IdsIn {
    in: [ID]!
  }

  input WhereIdsIn {
    ids: IdsIn
  }

  type Book {
    id: ID!
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
          firstName: 'Mark',
          lastName: 'Dark'
        }
      },
      11: {
        id: 11,
        name: {
          firstName: 'Daisy',
          lastName: 'Dyson'
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
      authors: (_, args) => Object.values(data.authors).filter(a => args.where.ids.in.includes(String(a.id)))
    },
    Author: {
      todos (parent, { priority }) {
        return Object.values(data.todos).filter((t) => {
          return String(t.authorId) === parent.id && String(t.priority) === priority
        })
      },
      books: (author, args, context, info) => {
        // pretend to call books-subgraph service
        const books = {
          10: [{ id: 1 }, { id: 2 }],
          11: [{ id: 3 }, { id: 4 }]
        }
        return books[author?.id]
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
    },
    Book: {
      pkey: 'id'
    }
  }

  return { schema, resolvers, entities, data, reset }
}

const reviewsSubgraph = () => {
  const schema = `
  input ReviewInput {
    bookId: ID!
    rating: Int!
    content: String!
  }

  type Review {
    id: ID!
    rating: Int!
    content: String!
  }

  type Book {
    id: ID!
    reviews: [Review]!
  }

  type ReviewWithBook {
    id: ID!
    rating: Int!
    content: String!
    book: Book!
  }

  type Query {
    getReview(id: ID!): Review
    getReviewBook(id: ID!): Book
    getReviewBookByIds(ids: [ID]!): [Book]!
    getReviewsByBookId(id: ID!): [Review]!
  }
`

  const data = { reviews: null, books: null }

  function reset () {
    data.reviews = {
      1: {
        id: 1,
        rating: 2,
        content: 'Would not read again.'
      },
      2: {
        id: 2,
        rating: 3,
        content: 'So so.'
      },
      3: {
        id: 3,
        rating: 5,
        content: 'Wow.'
      },
      4: {
        id: 4,
        rating: 1,
        content: 'Good to start the fire.'
      }
    }

    data.books = {
      1: {
        id: 1,
        reviews: [1]
      },
      2: {
        id: 2,
        reviews: [2]
      },
      3: {
        id: 3,
        reviews: [2, 3, 4]
      },
      4: {
        id: 4,
        reviews: []
      }
    }
  }

  reset()

  const resolvers = {
    Query: {
      getReview (_, { id }) {
        return data.reviews[id]
      },
      getReviewBook (_, { id }) {
        if (!data.books[id]) { return null }
        const book = structuredClone(data.books[id])
        book.reviews = book.reviews.map((rid) => data.reviews[rid])
        return book
      },
      getReviewsByBookId (_, { id }) {
        return data.books[id]?.reviews.map((rid) => {
          return data.reviews[rid]
        })
      },
      getReviewBookByIds (_, { ids }) {
        return ids.map((id) => {
          if (!data.books[id]) { return null }
          const book = structuredClone(data.books[id])
          book.reviews = book.reviews.map((rid) => data.reviews[rid])
          return book
        })
      }
    }
  }

  const entities = {
    Book: {
      pkey: 'id',
      resolver: {
        name: 'getReviewBookByIds',
        argsAdapter (partialResults) {
          return {
            ids: partialResults.map(r => r.id)
          }
        }
      }
    }
  }

  return { schema, resolvers, entities, data, reset }
}

async function setupComposer (t) {
  const books = booksSubgraph()
  const authors = authorsSubgraph()
  const reviews = reviewsSubgraph()

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
    },
    {
      name: 'reviews-subgraph',
      mercurius: {
        schema: reviews.schema,
        resolvers: reviews.resolvers
      },
      entities: reviews.entities,
      listen: true
    }
  ])

  const pino = require('pino')
  const options = {
    logger: pino({ level: 'debug' }),
    subgraphs: services.map(service => ({
      name: service.name,
      server: { host: service.host },
      entities: service.config.entities
    }))
  }

  const { service } = await createComposerService(t, { compose, options })
  return service
}

test('should resolve nested foreign types with lists in the result', { only: 1 }, async (t) => {
  const query = `{
    booksByAuthors(authorIds: [10,11,12]) {
      title
      author { 
        name { firstName, lastName } 
        books { 
          reviews { rating } 
        }
      }
    }
  }`

  const expectedResult = { booksByAuthors: [{ title: 'A Book About Things That Never Happened', author: { name: { firstName: 'Mark', lastName: 'Dark' }, books: [{ reviews: [{ rating: 2 }] }, { reviews: [{ rating: 3 }] }] } }, { title: 'A Book About Things That Really Happened', author: { name: { firstName: 'Mark', lastName: 'Dark' }, books: [{ reviews: [{ rating: 2 }] }, { reviews: [{ rating: 3 }] }] } }, { title: 'Watering the plants', author: { name: { firstName: 'Daisy', lastName: 'Dyson' }, books: [{ reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }] }, { reviews: [] }] } }, { title: 'Pruning the branches', author: { name: { firstName: 'Daisy', lastName: 'Dyson' }, books: [{ reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }] }, { reviews: [] }] } }] }

  const service = await setupComposer(t)

  const result = await graphqlRequest(service, query)

  assert.deepStrictEqual(result, expectedResult)
})
