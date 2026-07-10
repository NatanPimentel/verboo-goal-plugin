import { afterEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cleanEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

describe('goal MCP server', () => {
  let dataDir: string | undefined
  let client: Client | undefined
  let transport: StdioClientTransport | undefined

  afterEach(async () => {
    await client?.close()
    await transport?.close()
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  test('lists and executes the public goal tools over stdio', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'verboo-goal-mcp-'))
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['src/mcp/mcp-server.ts'],
      cwd: process.cwd(),
      env: { ...cleanEnvironment(), GOAL_PLUGIN_DATA: dataDir },
    })
    client = new Client({ name: 'goal-test-client', version: '0.1.0' })
    await client.connect(transport)

    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name)).toEqual([
      'get_goal',
      'get_goal_history',
      'create_goal',
      'set_goal',
      'update_goal_objective',
      'update_goal_status',
      'update_goal',
      'clear_goal',
    ])

    const created = await client.callTool({
      name: 'create_goal',
      arguments: { session_id: 'mcp-session', objective: 'Test MCP lifecycle' },
    })
    expect(created.isError).not.toBe(true)

    const current = await client.callTool({
      name: 'get_goal',
      arguments: { session_id: 'mcp-session' },
    })
    expect(JSON.stringify(current.structuredContent)).toContain(
      'Test MCP lifecycle',
    )

    const invalidCompletion = await client.callTool({
      name: 'update_goal',
      arguments: { session_id: 'mcp-session', status: 'complete' },
    })
    expect(invalidCompletion.isError).toBe(true)

    const completed = await client.callTool({
      name: 'update_goal',
      arguments: {
        session_id: 'mcp-session',
        status: 'complete',
        evidence: 'MCP create/get/update round-trip passed.',
      },
    })
    expect(completed.isError).not.toBe(true)
  })
})
