import { loadDefaultGoalConfig } from '../core/config.js'
import { savePersistedGoalConfig } from '../core/config-file.js'
import { asGoalError } from '../core/errors.js'
import { GoalService } from '../core/service.js'
import { GoalStore } from '../core/store.js'

const MAX_STDIN_BYTES = 1_048_576
let currentEvent: string | undefined

const readInput = async (): Promise<Record<string, unknown>> => {
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += String(chunk)
    if (Buffer.byteLength(raw, 'utf8') > MAX_STDIN_BYTES) {
      throw new Error('Hook input exceeded 1 MiB.')
    }
  }
  return JSON.parse(raw) as Record<string, unknown>
}

const requiredString = (
  input: Record<string, unknown>,
  key: string,
): string => {
  const value = input[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Hook input is missing ${key}.`)
  }
  return value
}

const optionalString = (
  input: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = input[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const writeJson = (value: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

const main = async (): Promise<void> => {
  const input = await readInput()
  const event = requiredString(input, 'hook_event_name')
  currentEvent = event
  const sessionId = requiredString(input, 'session_id')
  const transcriptPath = requiredString(input, 'transcript_path')
  const dataDir =
    process.env.CLAUDE_PLUGIN_DATA ?? process.env.GOAL_PLUGIN_DATA ?? ''
  const defaults = loadDefaultGoalConfig()
  await savePersistedGoalConfig(dataDir, defaults)
  const service = new GoalService(
    new GoalStore(dataDir),
    defaults,
  )

  switch (event) {
    case 'Stop': {
      const permissionMode = optionalString(input, 'permission_mode')
      const lastAssistantMessage = optionalString(
        input,
        'last_assistant_message',
      )
      const output = await service.handleStop({
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: requiredString(input, 'cwd'),
        hook_event_name: 'Stop',
        stop_hook_active: input.stop_hook_active === true,
        ...(permissionMode !== undefined
          ? { permission_mode: permissionMode }
          : {}),
        ...(lastAssistantMessage !== undefined
          ? { last_assistant_message: lastAssistantMessage }
          : {}),
      })
      if (output) writeJson(output as Record<string, unknown>)
      return
    }
    case 'StopFailure':
      await service.handleStopFailure({
        session_id: sessionId,
        transcript_path: transcriptPath,
        error: optionalString(input, 'error') ?? 'unknown',
      })
      return
    case 'UserPromptSubmit': {
      const permissionMode = optionalString(input, 'permission_mode')
      await service.handleUserPrompt({
        session_id: sessionId,
        transcript_path: transcriptPath,
        ...(permissionMode !== undefined
          ? { permission_mode: permissionMode }
          : {}),
      })
      const reminder = await service.getReminderContext(sessionId)
      if (reminder) {
        writeJson({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: reminder,
          },
        })
      }
      return
    }
    case 'SessionStart': {
      const source = optionalString(input, 'source')
      if (
        source !== 'startup' &&
        source !== 'resume' &&
        source !== 'clear' &&
        source !== 'compact'
      ) {
        throw new Error('SessionStart hook has an invalid source.')
      }
      await service.handleSessionStart({
        session_id: sessionId,
        transcript_path: transcriptPath,
        source,
      })
      const reminder = await service.getReminderContext(sessionId)
      if (reminder) {
        writeJson({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: reminder,
          },
        })
      }
      return
    }
    case 'SessionEnd':
      await service.handleSessionEnd({
        session_id: sessionId,
        transcript_path: transcriptPath,
      })
      return
    case 'PreCompact': {
      const context = await service.getPreCompactContext(sessionId)
      if (context) process.stdout.write(`${context}\n`)
      return
    }
    case 'PostCompact':
      await service.handlePostCompact({
        session_id: sessionId,
        compact_summary: optionalString(input, 'compact_summary') ?? '',
      })
      return
    case 'SubagentStart':
      await service.handleSubagentStart({
        session_id: sessionId,
        agent_id: requiredString(input, 'agent_id'),
        agent_type: optionalString(input, 'agent_type') ?? '',
      })
      return
    case 'SubagentStop':
      await service.handleSubagentStop({
        session_id: sessionId,
        agent_id: requiredString(input, 'agent_id'),
      })
      return
    default:
      throw new Error(`Unsupported hook event: ${event}`)
  }
}

try {
  await main()
} catch (error) {
  const goalError = asGoalError(error)
  process.stderr.write(`goal hook warning [${goalError.code}]: ${goalError.message}\n`)
  // Hooks must fail open. Only Stop accepts a top-level systemMessage; plain
  // stdout from PreCompact would be injected into compaction instructions.
  if (currentEvent === 'Stop') {
    try {
      writeJson({
        systemMessage: `Goal auto-continuation was disabled for this turn: ${goalError.message}`,
      })
    } catch {
      // stdout may already be closed during shutdown.
    }
  }
}
