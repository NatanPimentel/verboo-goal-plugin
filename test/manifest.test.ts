import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

const readMcpServerVersion = async (path: string): Promise<string> => {
  const source = await readFile(path, 'utf8')
  const match = /\bVERSION\s*=\s*['"]([^'"]+)['"]/.exec(source)
  if (!match?.[1]) throw new Error(`Could not find the MCP version in ${path}.`)
  return match[1]
}

describe('plugin package', () => {
  test('keeps release versions synchronized', async () => {
    const pkg = await readJson('package.json')
    const plugin = await readJson('.claude-plugin/plugin.json')
    const marketplace = await readJson('.claude-plugin/marketplace.json')
    const entries = marketplace.plugins as Array<Record<string, unknown>>
    const packageVersion = pkg.version
    if (typeof packageVersion !== 'string') {
      throw new Error('package.json must declare a string version.')
    }
    expect(plugin.version).toBe(packageVersion)
    expect(entries[0]?.version).toBe(packageVersion)
    expect(await readMcpServerVersion('src/mcp/mcp-server.ts')).toBe(
      packageVersion,
    )
    expect(await readMcpServerVersion('dist/mcp-server.mjs')).toBe(
      packageVersion,
    )
  })

  test('uses Node-only portable hook commands', async () => {
    const hooks = await readFile('hooks/hooks.json', 'utf8')
    expect(hooks).toContain('node \\"${CLAUDE_PLUGIN_ROOT}/dist/hook-runner.mjs\\"')
    expect(hooks).toContain('"PreToolUse"')
    expect(hooks).toContain('"PermissionRequest"')
    expect(hooks).toContain('"Elicitation"')
    expect(hooks).not.toMatch(/\b(jq|perl|python|bash)\b/i)
  })

  test('exposes the session-scoped permission consent option', async () => {
    const plugin = await readJson('.claude-plugin/plugin.json')
    const userConfig = plugin.userConfig as Record<string, Record<string, unknown>>
    expect(userConfig.auto_approve_permissions).toMatchObject({
      type: 'boolean',
      default: true,
    })
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
