export type GoalErrorCode =
  | 'NO_ACTIVE_GOAL'
  | 'UNFINISHED_GOAL'
  | 'PLAN_MODE'
  | 'INVALID_TRANSITION'
  | 'VALIDATION_ERROR'
  | 'CORRUPT_STATE'
  | 'STATE_UNAVAILABLE'
  | 'LOCK_TIMEOUT'
  | 'INTERNAL_ERROR'
  | 'TASK_LIMIT'
  | 'INVALID_TASK_ID'
  | 'DEPTH_EXCEEDED'
  | 'TASK_NOT_FOUND'
  | 'INVALID_TASK_TRANSITION'

export class GoalError extends Error {
  readonly code: GoalErrorCode
  readonly details?: Record<string, unknown>

  constructor(
    code: GoalErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'GoalError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export const asGoalError = (error: unknown): GoalError => {
  if (error instanceof GoalError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new GoalError('INTERNAL_ERROR', message)
}
