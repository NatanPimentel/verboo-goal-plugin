import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

describe('plugin package', () => {
  test('keeps release versions synchronized', async () => {
    const pkg = await readJson('package.json')
    const plugin = await readJson('.claude-plugin/plugin.json')
    const marketplace = await readJson('.claude-plugin/marketplace.json')
    const entries = marketplace.plugins as Array<Record<string, unknown>>
    expect(plugin.version).toBe(pkg.version)
    expect(entries[0]?.version).toBe(pkg.version)
  })

  test('uses Node-only portable hook commands', async () => {
    const hooks = await readFile('hooks/hooks.json', 'utf8')
    expect(hooks).toContain('node \\"${CLAUDE_PLUGIN_ROOT}/dist/hook-runner.mjs\\"')
    expect(hooks).not.toMatch(/\b(jq|perl|python|bash)\b/i)
  })

  test('does not require user options before the MCP server can start', async () => {
    const mcp = await readFile('.mcp.json', 'utf8')
    expect(mcp).not.toContain('${user_config.')
    expect(mcp).toContain('${CLAUDE_PLUGIN_ROOT}')
  })

  test('exposes the exact /goal name and scoped tools', async () => {
    const command = await readFile('commands/goal.md', 'utf8')
    expect(command).toContain('\nname: goal\n')
    expect(command).toContain('${CLAUDE_SESSION_ID}')
    expect(command).toContain('mcp__plugin_goal_goal__update_goal')
    expect(command).toContain('disable-model-invocation: true')
  })
})
