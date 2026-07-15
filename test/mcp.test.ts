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
      'add_checkpoint',
      'add_task',
      'update_task',
      'get_tasks',
      'assign_task',
      'get_active_task',
      'add_subgoal',
      'get_subgoal',
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

  test('manages task board and subgoals over stdio', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'verboo-goal-mcp-tasks-'))
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['src/mcp/mcp-server.ts'],
      cwd: process.cwd(),
      env: { ...cleanEnvironment(), GOAL_PLUGIN_DATA: dataDir },
    })
    client = new Client({ name: 'goal-test-client', version: '0.2.0' })
    await client.connect(transport)

    await client.callTool({
      name: 'create_goal',
      arguments: { session_id: 'task-session', objective: 'Build feature' },
    })

    const added = await client.callTool({
      name: 'add_task',
      arguments: {
        session_id: 'task-session',
        type: 'scout',
        assignee: 'scout',
        objective: 'Explore API',
      },
    })
    expect(added.isError).not.toBe(true)
    expect(JSON.stringify(added.structuredContent)).toContain('T001')

    const active = await client.callTool({
      name: 'get_active_task',
      arguments: { session_id: 'task-session' },
    })
    expect(active.isError).not.toBe(true)
    expect(JSON.stringify(active.structuredContent)).toContain('T001')

    const updated = await client.callTool({
      name: 'update_task',
      arguments: {
        session_id: 'task-session',
        task_id: 'T001',
        receipt: {
          result: 'done',
          summary: 'API explored',
        },
      },
    })
    expect(updated.isError).not.toBe(true)
    expect(JSON.stringify(updated.structuredContent)).toContain('done')

    await client.callTool({
      name: 'add_task',
      arguments: {
        session_id: 'task-session',
        type: 'worker',
        assignee: 'worker',
        objective: 'Implement endpoint',
      },
    })

    const subgoal = await client.callTool({
      name: 'add_subgoal',
      arguments: {
        session_id: 'task-session',
        parent_task_id: 'T002',
        objective: 'Implement endpoint',
      },
    })
    expect(subgoal.isError).not.toBe(true)
    expect(JSON.stringify(subgoal.structuredContent)).toContain('Implement endpoint')

    const retrieved = await client.callTool({
      name: 'get_subgoal',
      arguments: {
        session_id: 'task-session',
        subgoal_id: (subgoal.structuredContent as { data: { goalId: string } }).data.goalId,
      },
    })
    expect(retrieved.isError).not.toBe(true)
    expect(JSON.stringify(retrieved.structuredContent)).toContain('Implement endpoint')
  })
})
