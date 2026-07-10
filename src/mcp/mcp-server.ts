import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { loadPersistedGoalConfig } from '../core/config-file.js'
import { asGoalError, GoalError } from '../core/errors.js'
import { formatGoalView } from '../core/prompts.js'
import { GoalService } from '../core/service.js'
import { GoalStore } from '../core/store.js'

const VERSION = '0.1.0'
const dataDir =
  process.env.CLAUDE_PLUGIN_DATA ?? process.env.GOAL_PLUGIN_DATA ?? ''
const store = new GoalStore(dataDir)

const createService = async (): Promise<GoalService> =>
  new GoalService(store, await loadPersistedGoalConfig(dataDir))

const sessionSchema = z.object({ session_id: z.string().min(1).max(256) })
const createSchema = sessionSchema.extend({
  objective: z.string().min(1).max(4_000),
  token_budget: z.number().int().min(0).max(10_000_000).optional(),
  max_auto_turns: z.number().int().min(1).max(100).optional(),
  max_duration_seconds: z.number().int().min(0).max(86_400).optional(),
  auto_continue: z.boolean().optional(),
})
const objectiveSchema = sessionSchema.extend({
  objective: z.string().min(1).max(4_000),
})
const statusSchema = sessionSchema.extend({
  status: z.enum(['active', 'paused']),
})
const finishSchema = sessionSchema.extend({
  status: z.enum(['complete', 'unmet']),
  evidence: z.string().max(4_000).optional(),
  blocker: z.string().max(4_000).optional(),
})

const objectSchema = (
  properties: Record<string, object>,
  required: string[],
): Tool['inputSchema'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const sessionProperty = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
  description:
    'The real Verboo session ID supplied by /goal or a goal continuation prompt. Never invent one.',
}

const tools: Tool[] = [
  {
    name: 'get_goal',
    description: 'Read the current goal and its usage for one Verboo session.',
    inputSchema: objectSchema({ session_id: sessionProperty }, ['session_id']),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'get_goal_history',
    description: 'Read up to 50 recent goal outcomes for one Verboo session.',
    inputSchema: objectSchema({ session_id: sessionProperty }, ['session_id']),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'create_goal',
    description:
      'Create a goal only when the user explicitly invokes /goal or explicitly asks to set a goal. Never infer goals from ordinary tasks.',
    inputSchema: objectSchema(
      {
        session_id: sessionProperty,
        objective: { type: 'string', minLength: 1, maxLength: 4_000 },
        token_budget: {
          type: 'integer',
          minimum: 0,
          maximum: 10_000_000,
          description: 'Total tokens; 0 uses an unlimited budget.',
        },
        max_auto_turns: { type: 'integer', minimum: 1, maximum: 100 },
        max_duration_seconds: {
          type: 'integer',
          minimum: 0,
          maximum: 86_400,
          description: 'Active seconds; 0 means unlimited.',
        },
        auto_continue: { type: 'boolean' },
      },
      ['session_id', 'objective'],
    ),
  },
  {
    name: 'set_goal',
    description:
      'Compatibility alias of create_goal. Use only after an explicit user request; it never force-replaces an unfinished goal.',
    inputSchema: objectSchema(
      {
        session_id: sessionProperty,
        objective: { type: 'string', minLength: 1, maxLength: 4_000 },
        token_budget: { type: 'integer', minimum: 0, maximum: 10_000_000 },
        max_auto_turns: { type: 'integer', minimum: 1, maximum: 100 },
        max_duration_seconds: {
          type: 'integer',
          minimum: 0,
          maximum: 86_400,
        },
        auto_continue: { type: 'boolean' },
      },
      ['session_id', 'objective'],
    ),
  },
  {
    name: 'update_goal_objective',
    description: 'Edit the objective of the unfinished goal in this session.',
    inputSchema: objectSchema(
      {
        session_id: sessionProperty,
        objective: { type: 'string', minLength: 1, maxLength: 4_000 },
      },
      ['session_id', 'objective'],
    ),
  },
  {
    name: 'update_goal_status',
    description:
      'Pause or resume an unfinished goal. Resuming is rejected while Verboo is in Plan mode.',
    inputSchema: objectSchema(
      {
        session_id: sessionProperty,
        status: { type: 'string', enum: ['active', 'paused'] },
      },
      ['session_id', 'status'],
    ),
  },
  {
    name: 'update_goal',
    description:
      'Close an unfinished goal. complete requires concrete evidence; unmet requires a concrete external blocker or genuine impasse.',
    inputSchema: objectSchema(
      {
        session_id: sessionProperty,
        status: { type: 'string', enum: ['complete', 'unmet'] },
        evidence: { type: 'string', minLength: 1, maxLength: 4_000 },
        blocker: { type: 'string', minLength: 1, maxLength: 4_000 },
      },
      ['session_id', 'status'],
    ),
  },
  {
    name: 'clear_goal',
    description: 'Explicitly cancel the current goal while preserving history.',
    inputSchema: objectSchema({ session_id: sessionProperty }, ['session_id']),
    annotations: { destructiveHint: true, idempotentHint: true },
  },
]

const success = (
  message: string,
  data: unknown,
): {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} => ({
  content: [
    {
      type: 'text',
      text: `${message}\n${JSON.stringify(data, null, 2)}`,
    },
  ],
  structuredContent: { ok: true, data },
})

const failure = (error: unknown) => {
  const goalError = asGoalError(error)
  const payload = {
    ok: false,
    error: {
      code: goalError.code,
      message: goalError.message,
      ...(goalError.details ? { details: goalError.details } : {}),
    },
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  }
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new GoalError('VALIDATION_ERROR', z.prettifyError(result.error))
  }
  return result.data
}

const handleTool = async (name: string, raw: unknown) => {
  try {
    const service = await createService()
    switch (name) {
      case 'get_goal': {
        const input = parse(sessionSchema, raw)
        const goal = await service.getGoal(input.session_id)
        return success(formatGoalView(goal), goal)
      }
      case 'get_goal_history': {
        const input = parse(sessionSchema, raw)
        const history = await service.getHistory(input.session_id)
        return success(`Found ${history.length} goal history entries.`, history)
      }
      case 'create_goal':
      case 'set_goal': {
        const input = parse(createSchema, raw)
        const goal = await service.createGoal(input.session_id, {
          objective: input.objective,
          ...(input.token_budget !== undefined
            ? { tokenBudget: input.token_budget }
            : {}),
          ...(input.max_auto_turns !== undefined
            ? { maxAutoTurns: input.max_auto_turns }
            : {}),
          ...(input.max_duration_seconds !== undefined
            ? { maxDurationSeconds: input.max_duration_seconds }
            : {}),
          ...(input.auto_continue !== undefined
            ? { autoContinue: input.auto_continue }
            : {}),
        })
        return success(formatGoalView(goal), goal)
      }
      case 'update_goal_objective': {
        const input = parse(objectiveSchema, raw)
        const goal = await service.updateObjective(
          input.session_id,
          input.objective,
        )
        return success(formatGoalView(goal), goal)
      }
      case 'update_goal_status': {
        const input = parse(statusSchema, raw)
        const goal = await service.updateStatus(input.session_id, input.status)
        return success(formatGoalView(goal), goal)
      }
      case 'update_goal': {
        const input = parse(finishSchema, raw)
        const goal = await service.finishGoal(input.session_id, input.status, {
          ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
          ...(input.blocker !== undefined ? { blocker: input.blocker } : {}),
        })
        return success(formatGoalView(goal), goal)
      }
      case 'clear_goal': {
        const input = parse(sessionSchema, raw)
        await service.clearGoal(input.session_id)
        return success('Goal cleared.', null)
      }
      default:
        throw new GoalError('VALIDATION_ERROR', `Unknown goal tool: ${name}`)
    }
  } catch (error) {
    return failure(error)
  }
}

const server = new Server(
  { name: 'verboo-goal', version: VERSION },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools }))
server.setRequestHandler(CallToolRequestSchema, request =>
  handleTool(request.params.name, request.params.arguments ?? {}),
)

const transport = new StdioServerTransport()
await server.connect(transport)

let closing = false
const close = async (): Promise<void> => {
  if (closing) return
  closing = true
  await server.close()
}
process.stdin.on('end', () => void close())
process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())
