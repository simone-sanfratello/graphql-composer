'use strict'

const { spec } = require('node:test/reporters')
const { run } = require('node:test')
const glob = require('glob').globSync

const files = glob('test/**/*.test.js')

const stream = run({
  files,
  timeout: process.env.ONLY ? Infinity : 30_000,
  concurrency: files.length,
  only: !!process.env.ONLY
})

stream.on('test:fail', (t) => {
  process.exitCode = 1
})

/* eslint-disable new-cap */
stream.compose(new spec()).pipe(process.stdout)
