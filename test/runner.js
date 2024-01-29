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
  fails.push(t)
  process.exitCode = 1
})

stream.on('end', () => {
  let failed = 0
  if (fails.length > 0) {
    for (const f of fails) {
      // TODO skip nesting error properly, add the name in the bottom test name
      // if (!f.details?.error?.cause?.message) { continue }
      // TODO better formatting, use stdout/stderr, get nesting test name
      console.log('---\n')
      console.log('File:', f.file)
      console.log('Test:', f.name)
      console.log('Error:', f.details.error)
      failed++
    }
    console.log('\n\n\n')
    console.log(' >>> failed:', failed)
  }
})

stream.compose(reporter).pipe(process.stdout)
