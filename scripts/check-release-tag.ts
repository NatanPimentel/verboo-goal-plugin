import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
  version: string
}
const expected = `v${pkg.version}`
const actual = process.env.GITHUB_REF_NAME

if (actual !== expected) {
  throw new Error(`Release tag ${actual ?? '<missing>'} must equal ${expected}.`)
}

process.stdout.write(`release tag ${actual} matches package version\n`)
