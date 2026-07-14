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
  })
  .strict()

export const sessionStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string().min(1),
    runtime: z
      .object({
        updatedAt: z.string().datetime(),
        permissionMode: z.string().optional(),
        transcriptPath: z.string().optional(),
      })
      .strict(),
    current: goalRecordSchema.nullable(),
    history: z.array(historySchema).max(50),
  })
  .strict()
