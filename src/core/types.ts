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
  evidence?: string[] | undefined
  facts?: string[] | undefined
  contradictions?: string[] | undefined
  verification?: string[] | undefined
}

export const TASK_TYPES = ['scout', 'worker', 'judge', 'pm'] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const TASK_STATUSES = ['queued', 'active', 'blocked', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_ASSIGNEES = ['scout', 'worker', 'judge', 'pm'] as const
export type TaskAssignee = (typeof TASK_ASSIGNEES)[number]

export interface TaskReceipt {
  result: 'done' | 'blocked'
  taskId: string
  summary: string
  evidence?: string[] | undefined
  facts?: string[] | undefined
  contradictions?: string[] | undefined
  changedFiles?: string[] | undefined
  commands?: string[] | undefined
  verificationAttempts?: string[] | undefined
  decision?:
    | 'approved'
    | 'rejected'
    | 'approve_subgoal'
    | 'reject_subgoal'
    | 'not_complete'
    | 'complete'
    | undefined
  fullOutcomeComplete?: boolean | undefined
  rationale?: string | undefined
}

export interface GoalTask {
  id: string
  type: TaskType
  assignee: TaskAssignee
  status: TaskStatus
  objective: string
  inputs?: string[] | undefined
  constraints?: string[] | undefined
  expectedOutput?: string[] | undefined
  allowedFiles?: string[] | undefined
  verify?: string[] | undefined
  stopIf?: string[] | undefined
  receipt?: TaskReceipt | undefined
  createdAt: string
  updatedAt: string
  parentSubgoalId?: string | undefined
}

export interface SubgoalReference {
  parentGoalId: string
  parentTaskId: string
  depth: 1
}

export interface ActiveSubagent {
  id: string
  type: string
  startedAt: string
  taskId?: string | undefined
}

export interface GoalRecord {
  id: string
  objective: string
  status: GoalStatus
  limits: GoalLimits
  usage: GoalUsage
  createdAt: string
  updatedAt: string
  activeSince?: string | undefined
  finishedAt?: string | undefined
  evidence?: string | undefined
  blocker?: string | undefined
  stopReason?: string | undefined
  wrapUpIssued: boolean
  checkpoints: GoalCheckpoint[]
  activeSubagents: ActiveSubagent[]
  accountedMessageIds: string[]
  lastAssistantId?: string | undefined
  lastAssistantSummary?: string | undefined
  lastStopFingerprint?: string | undefined
  duplicateStopCount: number
  subagentDeferrals: number
  tasks: GoalTask[]
  nextTaskId: number
  parent?: SubgoalReference | undefined
}

export interface SessionRuntime {
  updatedAt: string
  permissionMode?: string | undefined
  transcriptPath?: string | undefined
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
  evidence?: string | undefined
  blocker?: string | undefined
  stopReason?: string | undefined
  checkpoints: GoalCheckpoint[]
  tasks: GoalTask[]
  parent?: SubgoalReference | undefined
}

export interface SessionState {
  schemaVersion: 2
  sessionId: string
  runtime: SessionRuntime
  current: GoalRecord | null
  stack: GoalRecord[]
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
  finishedAt?: string | undefined
  evidence?: string | undefined
  blocker?: string | undefined
  stopReason?: string | undefined
  lastCheckpoint?: GoalCheckpoint | undefined
  checkpoints: GoalCheckpoint[]
  activeSubagents: ActiveSubagent[]
  tasks: GoalTask[]
  nextTaskId: number
  parent?: SubgoalReference | undefined
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
  tokenBudget?: number | null | undefined
  maxAutoTurns?: number | undefined
  maxDurationSeconds?: number | null | undefined
  autoContinue?: boolean | undefined
  tasks?:
    | Array<{
        type: TaskType
        assignee: TaskAssignee
        objective: string
        inputs?: string[] | undefined
        constraints?: string[] | undefined
        expectedOutput?: string[] | undefined
        allowedFiles?: string[] | undefined
        verify?: string[] | undefined
        stopIf?: string[] | undefined
      }>
    | undefined
}

export interface AddTaskInput {
  type: TaskType
  assignee: TaskAssignee
  objective: string
  inputs?: string[] | undefined
  constraints?: string[] | undefined
  expectedOutput?: string[] | undefined
  allowedFiles?: string[] | undefined
  verify?: string[] | undefined
  stopIf?: string[] | undefined
}

export interface TaskPatch {
  status?: TaskStatus | undefined
  assignee?: TaskAssignee | undefined
  objective?: string | undefined
  inputs?: string[] | undefined
  constraints?: string[] | undefined
  expectedOutput?: string[] | undefined
  allowedFiles?: string[] | undefined
  verify?: string[] | undefined
  stopIf?: string[] | undefined
  receipt?: TaskReceipt | undefined
}

export interface AddSubgoalInput {
  parentTaskId: string
  objective: string
  tokenBudget?: number | null | undefined
  maxAutoTurns?: number | undefined
  maxDurationSeconds?: number | null | undefined
  autoContinue?: boolean | undefined
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
