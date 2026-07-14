import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDefaultGoalConfig } from '../src/core/config.js'
import { GoalService } from '../src/core/service.js'
import { GoalStore } from '../src/core/store.js'
import type { DefaultGoalConfig } from '../src/core/types.js'

export interface TestContext {
  dataDir: string
  transcriptPath: string
  service: GoalService
  store: GoalStore
  clock: { now: number }
  cleanup: () => Promise<void>
}

export const createTestContext = async (
  overrides: Partial<DefaultGoalConfig> = {},
): Promise<TestContext> => {
  const dataDir = await mkdtemp(join(tmpdir(), 'verboo-goal-test-'))
  const transcriptPath = join(dataDir, 'transcript.jsonl')
  await writeFile(transcriptPath, '')
  const clock = { now: Date.parse('2026-07-10T12:00:00.000Z') }
  const store = new GoalStore(dataDir)
  const service = new GoalService(
    store,
    { ...loadDefaultGoalConfig({}), ...overrides },
    () => clock.now,
  )
  return {
    dataDir,
    transcriptPath,
    service,
    store,
    clock,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  }
}

export const assistantLine = (
  id: string,
  timestamp: number,
  usage: {
    input?: number
    output?: number
    cacheCreation?: number
    cacheRead?: number
  } = {},
): string =>
  JSON.stringify({
    type: 'assistant',
    uuid: `uuid-${id}-${timestamp}`,
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role: 'assistant',
      id,
      content: [{ type: 'text', text: `message ${id}` }],
      usage: {
        input_tokens: usage.input ?? 100,
        output_tokens: usage.output ?? 100,
        cache_creation_input_tokens: usage.cacheCreation ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
      },
    },
  })

export const stopInput = (
  context: TestContext,
  overrides: Record<string, unknown> = {},
) => ({
  session_id: 'session-test',
  transcript_path: context.transcriptPath,
  cwd: context.dataDir,
  hook_event_name: 'Stop' as const,
  stop_hook_active: false,
  last_assistant_message: 'Made meaningful progress and verified the result.',
  ...overrides,
})

export const permissionRequestInput = (
  context: TestContext,
  overrides: Record<string, unknown> = {},
) => ({
  session_id: 'session-test',
  transcript_path: context.transcriptPath,
  cwd: context.dataDir,
  hook_event_name: 'PermissionRequest' as const,
  permission_mode: 'default',
  tool_name: 'powershell',
  tool_input: { command: 'Write-Output permission-test' },
  ...overrides,
})

export const preToolUseInput = (
  context: TestContext,
  overrides: Record<string, unknown> = {},
) => ({
  session_id: 'session-test',
  transcript_path: context.transcriptPath,
  cwd: context.dataDir,
  hook_event_name: 'PreToolUse' as const,
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_input: { command: 'Write-Output pre-tool-use-test' },
  tool_use_id: 'tool-use-test',
  ...overrides,
})

export const elicitationInput = (
  context: TestContext,
  overrides: Record<string, unknown> = {},
) => ({
  session_id: 'session-test',
  transcript_path: context.transcriptPath,
  cwd: context.dataDir,
  hook_event_name: 'Elicitation' as const,
  permission_mode: 'default',
  mcp_server_name: 'remote-mcp',
  message: 'Choose an account to continue.',
  mode: 'form' as const,
  requested_schema: {
    type: 'object',
    properties: { account: { type: 'string' } },
  },
  ...overrides,
})
