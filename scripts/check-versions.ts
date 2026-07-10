import { readFile } from 'node:fs/promises'

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

const pkg = await readJson('package.json')
const plugin = await readJson('.claude-plugin/plugin.json')
const marketplace = await readJson('.claude-plugin/marketplace.json')
const entries = marketplace.plugins as Array<Record<string, unknown>>
const versions = [pkg.version, plugin.version, entries[0]?.version]

if (versions.some(version => version !== versions[0])) {
  throw new Error(`Version mismatch: ${versions.join(', ')}`)
}

process.stdout.write(`version ${String(versions[0])} is synchronized\n`)
