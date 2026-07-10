import { GoalError } from './errors.js'
import type {
  CreateGoalInput,
  DefaultGoalConfig,
  GoalLimits,
} from './types.js'

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false
  return fallback
}

const parseInteger = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback
}

const parseNullableLimit = (
  value: string | undefined,
  fallback: number | null,
  max: number,
): number | null => {
  const parsed = parseInteger(value, fallback ?? 0, 0, max)
  return parsed === 0 ? null : parsed
}

const option = (
  env: NodeJS.ProcessEnv,
  directName: string,
  pluginOptionName: string,
): string | undefined => env[directName] ?? env[pluginOptionName]

export const loadDefaultGoalConfig = (
  env: NodeJS.ProcessEnv = process.env,
): DefaultGoalConfig => ({
  autoContinue: parseBoolean(
    option(env, 'GOAL_AUTO_CONTINUE', 'CLAUDE_PLUGIN_OPTION_AUTO_CONTINUE'),
    true,
  ),
  deferWhileSubagentsActive: parseBoolean(
    option(
      env,
      'GOAL_DEFER_WHILE_SUBAGENTS_ACTIVE',
      'CLAUDE_PLUGIN_OPTION_DEFER_WHILE_SUBAGENTS_ACTIVE',
    ),
    true,
  ),
  maxAutoTurns: parseInteger(
    option(
      env,
      'GOAL_MAX_AUTO_TURNS',
      'CLAUDE_PLUGIN_OPTION_MAX_AUTO_TURNS',
    ),
    25,
    1,
    100,
  ),
  defaultTokenBudget: parseNullableLimit(
    option(
      env,
      'GOAL_DEFAULT_TOKEN_BUDGET',
      'CLAUDE_PLUGIN_OPTION_DEFAULT_TOKEN_BUDGET',
    ),
    null,
    10_000_000,
  ),
  maxDurationSeconds: parseNullableLimit(
    option(
      env,
      'GOAL_MAX_DURATION_SECONDS',
      'CLAUDE_PLUGIN_OPTION_MAX_GOAL_DURATION_SECONDS',
    ),
    null,
    86_400,
  ),
  noProgressTokenThreshold: parseInteger(
    option(
      env,
      'GOAL_NO_PROGRESS_TOKEN_THRESHOLD',
      'CLAUDE_PLUGIN_OPTION_NO_PROGRESS_TOKEN_THRESHOLD',
    ),
    50,
    0,
    1_000,
  ),
  maxNoProgressTurns: parseInteger(
    option(
      env,
      'GOAL_MAX_NO_PROGRESS_TURNS',
      'CLAUDE_PLUGIN_OPTION_MAX_NO_PROGRESS_TURNS',
    ),
    2,
    1,
    10,
  ),
  maxHookFailures: parseInteger(
    option(
      env,
      'GOAL_MAX_HOOK_FAILURES',
      'CLAUDE_PLUGIN_OPTION_MAX_HOOK_FAILURES',
    ),
    3,
    1,
    10,
  ),
  maxSubagentDeferrals: 3,
})

const assertInteger = (
  label: string,
  value: number,
  min: number,
  max: number,
): number => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new GoalError(
      'VALIDATION_ERROR',
      `${label} must be an integer between ${min} and ${max}.`,
    )
  }
  return value
}

export const normalizeGoalLimits = (
  input: CreateGoalInput,
  defaults: DefaultGoalConfig,
): GoalLimits => {
  const rawTokenBudget = input.tokenBudget ?? defaults.defaultTokenBudget
  const rawDuration = input.maxDurationSeconds ?? defaults.maxDurationSeconds

  const tokenBudget =
    rawTokenBudget === null || rawTokenBudget === 0
      ? null
      : assertInteger('token_budget', rawTokenBudget, 1, 10_000_000)
  const maxDurationSeconds =
    rawDuration === null || rawDuration === 0
      ? null
      : assertInteger('max_duration_seconds', rawDuration, 1, 86_400)

  return {
    tokenBudget,
    maxAutoTurns: assertInteger(
      'max_auto_turns',
      input.maxAutoTurns ?? defaults.maxAutoTurns,
      1,
      100,
    ),
    maxDurationSeconds,
    autoContinue: input.autoContinue ?? defaults.autoContinue,
    deferWhileSubagentsActive: defaults.deferWhileSubagentsActive,
    noProgressTokenThreshold: defaults.noProgressTokenThreshold,
    maxNoProgressTurns: defaults.maxNoProgressTurns,
    maxHookFailures: defaults.maxHookFailures,
    maxSubagentDeferrals: defaults.maxSubagentDeferrals,
  }
}

export const validateText = (label: string, value: string): string => {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new GoalError('VALIDATION_ERROR', `${label} cannot be empty.`)
  }
  if (normalized.length > 4_000) {
    throw new GoalError(
      'VALIDATION_ERROR',
      `${label} cannot exceed 4,000 characters.`,
    )
  }
  return normalized
}
