'use strict'

const { tap, spec } = require('node:test/reporters')
const { run } = require('node:test')
const glob = require('glob').globSync

/* eslint-disable new-cap */
const reporter = process.stdout.isTTY ? new spec() : tap

const files = glob('test/**/*.test.js')

const stream = run({
  files,
  timeout: process.env.ONLY ? Infinity : 30_000,
  concurrency: files.length,
  only: !!process.env.ONLY
})

const fails = []

stream.on('test:fail', (t) => {
  if (!t.details.error.cause) { return }
  fails.push(t)
  process.exitCode = 1
})

stream.on('end', () => {
  // TODO better formatting
  if (fails.length > 0) {
    for (const f of fails) {
      console.log('---\n')
      console.log('File:', f.file)
      console.log('Test:', f.name)
      console.log('Error:', f.details.error.cause.message)
    }

    console.log('\n\n\n')
  }
})

stream.compose(reporter).pipe(process.stdout)
