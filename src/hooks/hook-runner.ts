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

const writeJson = (value: object): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

const isAutonomyEvent = (event: string): boolean =>
  event === 'PreToolUse' ||
  event === 'PermissionRequest' ||
  event === 'Elicitation'

const isPlanMode = (mode: string | undefined): boolean =>
  mode?.toLowerCase() === 'plan'

const failClosedGuidance = (kind: string, code: string): string =>
  `${kind} was declined fail-closed because the goal state could not be verified (${code}). Try a safe alternative or another available path; do not repeat the same request indefinitely. Request user input only if a genuine external dependency makes further progress impossible.`

const preToolUseDeny = (message: string): Record<string, unknown> => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: message,
  },
})

const permissionRequestDeny = (message: string): Record<string, unknown> => ({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: {
      behavior: 'deny',
      message,
    },
  },
})

const elicitationDecline = (message?: string): Record<string, unknown> => ({
  ...(message !== undefined ? { systemMessage: message } : {}),
  hookSpecificOutput: {
    hookEventName: 'Elicitation',
    action: 'decline',
  },
})

const main = async (): Promise<void> => {
  const input = await readInput()
  const event = requiredString(input, 'hook_event_name')
  currentEvent = event
  const dataDir =
    process.env.CLAUDE_PLUGIN_DATA ?? process.env.GOAL_PLUGIN_DATA ?? ''
  const defaults = loadDefaultGoalConfig()
  if (
    isAutonomyEvent(event) &&
    (!defaults.autoApprovePermissions ||
      isPlanMode(optionalString(input, 'permission_mode')))
  ) {
    return
  }
  const sessionId = requiredString(input, 'session_id')
  const transcriptPath = requiredString(input, 'transcript_path')
  if (event === 'UserPromptSubmit' || event === 'SessionStart') {
    await savePersistedGoalConfig(dataDir, defaults)
  }
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
      const permissionMode = optionalString(input, 'permission_mode')
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
        ...(permissionMode !== undefined
          ? { permission_mode: permissionMode }
          : {}),
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
        ...(input.task_id !== undefined && typeof input.task_id === 'string'
          ? { task_id: input.task_id }
          : {}),
      })
      return
    case 'SubagentStop':
      await service.handleSubagentStop({
        session_id: sessionId,
        agent_id: requiredString(input, 'agent_id'),
        ...(input.task_id !== undefined && typeof input.task_id === 'string'
          ? { task_id: input.task_id }
          : {}),
      })
      return
    case 'PreToolUse': {
      const permissionMode = optionalString(input, 'permission_mode')
      const output = await service.handlePreToolUse({
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: requiredString(input, 'cwd'),
        hook_event_name: 'PreToolUse',
        tool_name: requiredString(input, 'tool_name'),
        tool_input: input.tool_input,
        tool_use_id: requiredString(input, 'tool_use_id'),
        ...(permissionMode !== undefined
          ? { permission_mode: permissionMode }
          : {}),
      })
      if (output) writeJson(output)
      return
    }
    case 'PermissionRequest': {
      const permissionMode = optionalString(input, 'permission_mode')
      const output = await service.handlePermissionRequest({
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: requiredString(input, 'cwd'),
        hook_event_name: 'PermissionRequest',
        tool_name: requiredString(input, 'tool_name'),
        tool_input: input.tool_input,
        ...(permissionMode !== undefined
          ? { permission_mode: permissionMode }
          : {}),
        ...(input.permission_suggestions !== undefined
          ? { permission_suggestions: input.permission_suggestions }
          : {}),
      })
      if (output) writeJson(output)
      return
    }
    case 'Elicitation': {
      const permissionMode = optionalString(input, 'permission_mode')
      const mode = optionalString(input, 'mode')
      const url = optionalString(input, 'url')
      const elicitationId = optionalString(input, 'elicitation_id')
      const output = await service.handleElicitation({
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: requiredString(input, 'cwd'),
        hook_event_name: 'Elicitation',
        mcp_server_name: requiredString(input, 'mcp_server_name'),
        message: requiredString(input, 'message'),
        ...(permissionMode !== undefined
          ? { permission_mode: permissionMode }
          : {}),
        ...(mode === 'form' || mode === 'url' ? { mode } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(elicitationId !== undefined ? { elicitation_id: elicitationId } : {}),
      })
      if (output) writeJson(output)
      return
    }
    default:
      throw new Error(`Unsupported hook event: ${event}`)
  }
}

try {
  await main()
} catch (error) {
  const goalError = asGoalError(error)
  process.stderr.write(`goal hook warning [${goalError.code}]: ${goalError.message}\n`)
  if (currentEvent === 'PreToolUse') {
    try {
      writeJson(
        preToolUseDeny(failClosedGuidance('Tool use', goalError.code)),
      )
    } catch {
      // stdout may already be closed during shutdown.
    }
  } else if (currentEvent === 'PermissionRequest') {
    try {
      writeJson(
        permissionRequestDeny(
          failClosedGuidance('Permission request', goalError.code),
        ),
      )
    } catch {
      // stdout may already be closed during shutdown.
    }
  } else if (currentEvent === 'Elicitation') {
    try {
      writeJson(
        elicitationDecline(failClosedGuidance('MCP elicitation', goalError.code)),
      )
    } catch {
      // stdout may already be closed during shutdown.
    }
  } else if (currentEvent === 'Stop') {
    // Only Stop accepts a top-level systemMessage; plain stdout from
    // PreCompact would be injected into compaction instructions.
    try {
      writeJson({
        systemMessage: `Goal auto-continuation was disabled for this turn: ${goalError.message}`,
      })
    } catch {
      // stdout may already be closed during shutdown.
    }
  }
}
