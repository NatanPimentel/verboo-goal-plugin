import { z } from 'zod'

const goalStatusSchema = z.enum([
  'active',
  'paused',
  'budgetLimited',
  'usageLimited',
  'complete',
  'unmet',
])

const limitsSchema = z
  .object({
    tokenBudget: z.number().int().positive().nullable(),
    maxAutoTurns: z.number().int().min(1).max(100),
    maxDurationSeconds: z.number().int().positive().nullable(),
    autoContinue: z.boolean(),
    deferWhileSubagentsActive: z.boolean(),
    noProgressTokenThreshold: z.number().int().min(0).max(1_000),
    maxNoProgressTurns: z.number().int().min(1).max(10),
    maxHookFailures: z.number().int().min(1).max(10),
    maxSubagentDeferrals: z.number().int().min(1).max(10),
  })
  .strict()

const usageSchema = z
  .object({
    tokens: z.number().int().nonnegative(),
    autoTurns: z.number().int().nonnegative(),
    accumulatedActiveMs: z.number().int().nonnegative(),
    noProgressTurns: z.number().int().nonnegative(),
    hookFailures: z.number().int().nonnegative(),
    unmeteredTurns: z.number().int().nonnegative(),
  })
  .strict()

const checkpointSchema = z
  .object({
    at: z.string().datetime(),
    summary: z.string().max(280),
    outputTokens: z.number().int().nonnegative(),
    evidence: z.array(z.string().min(1).max(280)).max(20).optional(),
    facts: z.array(z.string().min(1).max(280)).max(20).optional(),
    contradictions: z.array(z.string().min(1).max(280)).max(20).optional(),
    verification: z.array(z.string().min(1).max(280)).max(20).optional(),
  })
  .strict()

const subagentSchema = z
  .object({
    id: z.string().min(1),
    type: z.string(),
    startedAt: z.string().datetime(),
    taskId: z.string().optional(),
  })
  .strict()

const taskTypeSchema = z.enum(['scout', 'worker', 'judge', 'pm'])
const taskStatusSchema = z.enum(['queued', 'active', 'blocked', 'done'])
const taskAssigneeSchema = z.enum(['scout', 'worker', 'judge', 'pm'])

const taskReceiptSchema = z
  .object({
    result: z.enum(['done', 'blocked']),
    taskId: z.string().min(1),
    summary: z.string().min(1).max(4_000),
    evidence: z.array(z.string().min(1).max(280)).max(20).optional(),
    facts: z.array(z.string().min(1).max(280)).max(20).optional(),
    contradictions: z.array(z.string().min(1).max(280)).max(20).optional(),
    changedFiles: z.array(z.string().min(1).max(280)).max(20).optional(),
    commands: z.array(z.string().min(1).max(280)).max(20).optional(),
    verificationAttempts: z.array(z.string().min(1).max(280)).max(20).optional(),
    decision: z
      .enum([
        'approved',
        'rejected',
        'approve_subgoal',
        'reject_subgoal',
        'not_complete',
        'complete',
      ])
      .optional(),
    fullOutcomeComplete: z.boolean().optional(),
    rationale: z.string().min(1).max(4_000).optional(),
  })
  .strict()

const goalTaskSchema = z
  .object({
    id: z.string().min(1),
    type: taskTypeSchema,
    assignee: taskAssigneeSchema,
    status: taskStatusSchema,
    objective: z.string().min(1).max(4_000),
    inputs: z.array(z.string().min(1).max(280)).max(20).optional(),
    constraints: z.array(z.string().min(1).max(280)).max(20).optional(),
    expectedOutput: z.array(z.string().min(1).max(280)).max(20).optional(),
    allowedFiles: z.array(z.string().min(1).max(280)).max(20).optional(),
    verify: z.array(z.string().min(1).max(280)).max(20).optional(),
    stopIf: z.array(z.string().min(1).max(280)).max(20).optional(),
    receipt: taskReceiptSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    parentSubgoalId: z.string().optional(),
  })
  .strict()

const subgoalReferenceSchema = z
  .object({
    parentGoalId: z.string().min(1),
    parentTaskId: z.string().min(1),
    depth: z.literal(1),
  })
  .strict()

const goalRecordSchema = z
  .object({
    id: z.string().min(1),
    objective: z.string().min(1).max(4_000),
    status: goalStatusSchema,
    limits: limitsSchema,
    usage: usageSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    activeSince: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
    evidence: z.string().min(1).max(4_000).optional(),
    blocker: z.string().min(1).max(4_000).optional(),
    stopReason: z.string().min(1).max(4_000).optional(),
    wrapUpIssued: z.boolean(),
    checkpoints: z.array(checkpointSchema).max(8),
    activeSubagents: z.array(subagentSchema),
    accountedMessageIds: z.array(z.string()).max(512),
    lastAssistantId: z.string().optional(),
    lastAssistantSummary: z.string().max(280).optional(),
    lastStopFingerprint: z.string().optional(),
    duplicateStopCount: z.number().int().nonnegative(),
    subagentDeferrals: z.number().int().nonnegative(),
    tasks: z.array(goalTaskSchema).max(999),
    nextTaskId: z.number().int().min(1).max(1000),
    parent: subgoalReferenceSchema.optional(),
  })
  .strict()

const historySchema = z
  .object({
    goalId: z.string().min(1),
    outcome: z.enum([
      'complete',
      'unmet',
      'budgetLimited',
      'usageLimited',
      'cleared',
    ]),
    objective: z.string().min(1).max(4_000),
    status: goalStatusSchema,
    limits: limitsSchema,
    usage: usageSchema,
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    recordedAt: z.string().datetime(),
    evidence: z.string().min(1).max(4_000).optional(),
    blocker: z.string().min(1).max(4_000).optional(),
    stopReason: z.string().min(1).max(4_000).optional(),
    checkpoints: z.array(checkpointSchema).max(8),
    tasks: z.array(goalTaskSchema).max(999),
    parent: subgoalReferenceSchema.optional(),
  })
  .strict()

const runtimeSchema = z
  .object({
    updatedAt: z.string().datetime(),
    permissionMode: z.string().optional(),
    transcriptPath: z.string().optional(),
  })
  .strict()

const sessionStateSchemaV1 = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string().min(1),
    runtime: runtimeSchema,
    current: goalRecordSchema
      .omit({ tasks: true, nextTaskId: true, parent: true })
      .nullable(),
    history: z.array(historySchema.omit({ tasks: true, parent: true })).max(50),
  })
  .strict()

export { sessionStateSchemaV1 }

export const sessionStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    sessionId: z.string().min(1),
    runtime: runtimeSchema,
    current: goalRecordSchema.nullable(),
    stack: z.array(goalRecordSchema).max(8),
    history: z.array(historySchema).max(50),
  })
  .strict()

export type SessionStateV1 = z.infer<typeof sessionStateSchemaV1>
export type SessionStateV2 = z.infer<typeof sessionStateSchema>
