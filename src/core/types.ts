export const GOAL_STATUSES = [
  'active',
  'paused',
  'budgetLimited',
  'usageLimited',
  'complete',
  'unmet',
] as const

export type GoalStatus = (typeof GOAL_STATUSES)[number]

export type HistoryOutcome =
  | 'complete'
  | 'unmet'
  | 'budgetLimited'
  | 'usageLimited'
  | 'cleared'

export interface GoalLimits {
  tokenBudget: number | null
  maxAutoTurns: number
  maxDurationSeconds: number | null
  autoContinue: boolean
  deferWhileSubagentsActive: boolean
  noProgressTokenThreshold: number
  maxNoProgressTurns: number
  maxHookFailures: number
  maxSubagentDeferrals: number
}

export interface GoalUsage {
  tokens: number
  autoTurns: number
  accumulatedActiveMs: number
  noProgressTurns: number
  hookFailures: number
  unmeteredTurns: number
}

export interface GoalCheckpoint {
  at: string
  summary: string
  outputTokens: number
  evidence?: string[]
  facts?: string[]
  contradictions?: string[]
  verification?: string[]
}

export interface ActiveSubagent {
  id: string
  type: string
  startedAt: string
}

export interface GoalRecord {
  id: string
  objective: string
  status: GoalStatus
  limits: GoalLimits
  usage: GoalUsage
  createdAt: string
  updatedAt: string
  activeSince?: string
  finishedAt?: string
  evidence?: string
  blocker?: string
  stopReason?: string
  wrapUpIssued: boolean
  checkpoints: GoalCheckpoint[]
  activeSubagents: ActiveSubagent[]
  accountedMessageIds: string[]
  lastAssistantId?: string
  lastAssistantSummary?: string
  lastStopFingerprint?: string
  duplicateStopCount: number
  subagentDeferrals: number
}

export interface SessionRuntime {
  updatedAt: string
  permissionMode?: string
  transcriptPath?: string
}

export interface GoalHistoryEntry {
  goalId: string
  outcome: HistoryOutcome
  objective: string
  status: GoalStatus
  limits: GoalLimits
  usage: GoalUsage
  createdAt: string
  finishedAt: string
  recordedAt: string
  evidence?: string
  blocker?: string
  stopReason?: string
  checkpoints: GoalCheckpoint[]
}

export interface SessionState {
  schemaVersion: 1
  sessionId: string
  runtime: SessionRuntime
  current: GoalRecord | null
  history: GoalHistoryEntry[]
}

export interface GoalView {
  sessionId: string
  goalId: string
  objective: string
  status: GoalStatus
  limits: GoalLimits
  usage: GoalUsage & { elapsedMs: number }
  createdAt: string
  updatedAt: string
  finishedAt?: string
  evidence?: string
  blocker?: string
  stopReason?: string
  lastCheckpoint?: GoalCheckpoint
  checkpoints: GoalCheckpoint[]
  activeSubagents: ActiveSubagent[]
}

export interface DefaultGoalConfig {
  autoApprovePermissions: boolean
  autoContinue: boolean
  deferWhileSubagentsActive: boolean
  maxAutoTurns: number
  defaultTokenBudget: number | null
  maxDurationSeconds: number | null
  noProgressTokenThreshold: number
  maxNoProgressTurns: number
  maxHookFailures: number
  maxSubagentDeferrals: number
}

export interface CreateGoalInput {
  objective: string
  tokenBudget?: number | null
  maxAutoTurns?: number
  maxDurationSeconds?: number | null
  autoContinue?: boolean
}

export interface StopHookInput {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  hook_event_name: 'Stop'
  stop_hook_active: boolean
  last_assistant_message?: string
}

export interface StopHookOutput {
  decision?: 'block'
  reason?: string
  systemMessage?: string
  continue?: boolean
  stopReason?: string
}

export interface PreToolUseHookInput {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

export interface PreToolUseHookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'allow' | 'deny'
    permissionDecisionReason?: string
  }
}

export interface PermissionRequestHookInput {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: unknown
  permission_suggestions?: unknown
}

export type PermissionRequestDecision =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

export interface PermissionRequestHookOutput {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest'
    decision: PermissionRequestDecision
  }
}

export interface ElicitationHookInput {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  hook_event_name: 'Elicitation'
  mcp_server_name: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  elicitation_id?: string
  requested_schema?: Record<string, unknown>
}

export interface ElicitationHookOutput {
  hookSpecificOutput: {
    hookEventName: 'Elicitation'
    action: 'decline'
  }
}
