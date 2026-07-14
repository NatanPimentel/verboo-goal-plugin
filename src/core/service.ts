import { createHash, randomUUID } from 'node:crypto'
import { normalizeGoalLimits, validateText } from './config.js'
import { GoalError } from './errors.js'
import {
  buildContinuationPrompt,
  buildReminder,
  buildSubagentWaitPrompt,
  buildWrapUpPrompt,
  summarize,
} from './prompts.js'
import type { GoalStore } from './store.js'
import { estimateOutputTokens, readTranscriptUsage } from './transcript.js'
import type {
  CreateGoalInput,
  DefaultGoalConfig,
  GoalHistoryEntry,
  GoalRecord,
  GoalStatus,
  GoalView,
  HistoryOutcome,
  ElicitationHookInput,
  ElicitationHookOutput,
  PermissionRequestHookInput,
  PermissionRequestHookOutput,
  PreToolUseHookInput,
  PreToolUseHookOutput,
  SessionState,
  StopHookInput,
  StopHookOutput,
} from './types.js'

const isOpen = (status: GoalStatus): boolean =>
  status === 'active' || status === 'paused'

const isPlanMode = (mode: string | undefined): boolean =>
  mode?.toLowerCase() === 'plan'

const terminalOutcome = (status: GoalStatus): HistoryOutcome | null => {
  switch (status) {
    case 'complete':
    case 'unmet':
    case 'budgetLimited':
    case 'usageLimited':
      return status
    case 'active':
    case 'paused':
      return null
  }
}

const cloneUsage = (goal: GoalRecord): GoalRecord['usage'] => ({
  ...goal.usage,
})

export class GoalService {
  private readonly store: GoalStore
  private readonly defaults: DefaultGoalConfig
  private readonly now: () => number

  constructor(
    store: GoalStore,
    defaults: DefaultGoalConfig,
    now: () => number = Date.now,
  ) {
    this.store = store
    this.defaults = defaults
    this.now = now
  }

  async getGoal(sessionId: string): Promise<GoalView | null> {
    const state = await this.store.read(validateSessionId(sessionId))
    return state?.current ? this.toView(state.current, state.sessionId) : null
  }

  async getHistory(sessionId: string): Promise<GoalHistoryEntry[]> {
    const state = await this.store.read(validateSessionId(sessionId))
    return state ? state.history.map(entry => ({ ...entry })) : []
  }

  async createGoal(
    sessionId: string,
    input: CreateGoalInput,
  ): Promise<GoalView> {
    const validSessionId = validateSessionId(sessionId)
    const objective = validateText('objective', input.objective)
    const limits = normalizeGoalLimits(input, this.defaults)

    return this.store.update(validSessionId, state => {
      if (state.current && isOpen(state.current.status)) {
        throw new GoalError(
          'UNFINISHED_GOAL',
          'This session already has an unfinished goal. Complete, mark unmet, or clear it first.',
        )
      }

      const now = this.nowIso()
      const startsPaused = isPlanMode(state.runtime.permissionMode)
      const goal: GoalRecord = {
        id: randomUUID(),
        objective,
        status: startsPaused ? 'paused' : 'active',
        limits,
        usage: {
          tokens: 0,
          autoTurns: 0,
          accumulatedActiveMs: 0,
          noProgressTurns: 0,
          hookFailures: 0,
          unmeteredTurns: 0,
        },
        createdAt: now,
        updatedAt: now,
        wrapUpIssued: false,
        checkpoints: [],
        activeSubagents: [],
        accountedMessageIds: [],
        duplicateStopCount: 0,
        subagentDeferrals: 0,
      }
      if (!startsPaused) goal.activeSince = now
      else goal.stopReason = 'Created while the session was in Plan mode.'
      state.current = goal
      state.runtime.updatedAt = now
      return this.toView(goal, validSessionId)
    })
  }

  async updateObjective(
    sessionId: string,
    objective: string,
  ): Promise<GoalView> {
    const validSessionId = validateSessionId(sessionId)
    const validObjective = validateText('objective', objective)
    return this.store.update(validSessionId, state => {
      const goal = requireOpenGoal(state)
      goal.objective = validObjective
      goal.updatedAt = this.nowIso()
      return this.toView(goal, validSessionId)
    })
  }

  async updateStatus(
    sessionId: string,
    status: 'active' | 'paused',
  ): Promise<GoalView> {
    const validSessionId = validateSessionId(sessionId)
    return this.store.update(validSessionId, state => {
      const goal = requireOpenGoal(state)
      const nowMs = this.now()
      const now = new Date(nowMs).toISOString()

      if (status === goal.status) return this.toView(goal, validSessionId)
      if (status === 'active') {
        if (isPlanMode(state.runtime.permissionMode)) {
          throw new GoalError(
            'PLAN_MODE',
            'A goal cannot be resumed while the session is in Plan mode.',
          )
        }
        goal.status = 'active'
        goal.activeSince = now
        goal.usage.noProgressTurns = 0
        goal.usage.hookFailures = 0
        goal.duplicateStopCount = 0
        goal.subagentDeferrals = 0
        delete goal.stopReason
      } else {
        this.settleActiveTime(goal, nowMs)
        goal.status = 'paused'
        goal.stopReason = 'Paused explicitly.'
      }
      goal.updatedAt = now
      return this.toView(goal, validSessionId)
    })
  }

  async finishGoal(
    sessionId: string,
    status: 'complete' | 'unmet',
    details: { evidence?: string; blocker?: string },
  ): Promise<GoalView> {
    const validSessionId = validateSessionId(sessionId)
    const evidence =
      status === 'complete'
        ? validateText('evidence', details.evidence ?? '')
        : undefined
    const blocker =
      status === 'unmet'
        ? validateText('blocker', details.blocker ?? '')
        : undefined

    return this.store.update(validSessionId, state => {
      const goal = requireOpenGoal(state)
      const nowMs = this.now()
      const now = new Date(nowMs).toISOString()
      this.settleActiveTime(goal, nowMs)
      goal.status = status
      goal.finishedAt = now
      goal.updatedAt = now
      goal.stopReason =
        status === 'complete'
          ? 'Goal completed with evidence.'
          : 'Goal stopped at a concrete impasse.'
      if (evidence !== undefined) goal.evidence = evidence
      if (blocker !== undefined) goal.blocker = blocker
      this.archiveGoal(state, goal, status, now)
      return this.toView(goal, validSessionId)
    })
  }

  async clearGoal(sessionId: string): Promise<null> {
    const validSessionId = validateSessionId(sessionId)
    return this.store.update(validSessionId, state => {
      const goal = state.current
      if (goal && isOpen(goal.status)) {
        const nowMs = this.now()
        const now = new Date(nowMs).toISOString()
        this.settleActiveTime(goal, nowMs)
        goal.stopReason = 'Goal cleared explicitly.'
        goal.finishedAt = now
        goal.updatedAt = now
        this.archiveGoal(state, goal, 'cleared', now)
      }
      state.current = null
      state.runtime.updatedAt = this.nowIso()
      return null
    })
  }

  async handleUserPrompt(input: {
    session_id: string
    transcript_path: string
    permission_mode?: string
  }): Promise<GoalView | null> {
    return this.recordContext(
      input.session_id,
      input.transcript_path,
      input.permission_mode,
      true,
    )
  }

  async handleSessionStart(input: {
    session_id: string
    transcript_path: string
    source: 'startup' | 'resume' | 'clear' | 'compact'
    permission_mode?: string
  }): Promise<GoalView | null> {
    const validSessionId = validateSessionId(input.session_id)
    return this.store.update(validSessionId, state => {
      const nowMs = this.now()
      const now = new Date(nowMs).toISOString()
      this.updateRuntime(state, input.transcript_path, input.permission_mode, now)
      const goal = state.current
      if (!goal) return null
      if (input.source !== 'compact') {
        goal.activeSubagents = []
        goal.subagentDeferrals = 0
      }
      if (goal.status === 'active' && isPlanMode(input.permission_mode)) {
        this.pauseGoal(goal, nowMs, 'Paused because the session is in Plan mode.')
      }
      if (goal.status === 'active' && !goal.activeSince) goal.activeSince = now
      goal.updatedAt = now
      return this.toView(goal, validSessionId)
    })
  }

  async handleSessionEnd(input: {
    session_id: string
    transcript_path: string
  }): Promise<void> {
    const validSessionId = validateSessionId(input.session_id)
    await this.store.update(validSessionId, state => {
      const nowMs = this.now()
      const now = new Date(nowMs).toISOString()
      this.updateRuntime(state, input.transcript_path, undefined, now)
      if (state.current) {
        this.settleActiveTime(state.current, nowMs)
        state.current.activeSubagents = []
        state.current.subagentDeferrals = 0
        state.current.updatedAt = now
      }
    })
  }

  async handleSubagentStart(input: {
    session_id: string
    agent_id: string
    agent_type: string
  }): Promise<void> {
    const validSessionId = validateSessionId(input.session_id)
    await this.store.update(validSessionId, state => {
      const goal = state.current
      if (!goal || !isOpen(goal.status)) return
      const now = this.nowIso()
      const existing = goal.activeSubagents.find(agent => agent.id === input.agent_id)
      if (!existing) {
        goal.activeSubagents.push({
          id: input.agent_id,
          type: input.agent_type,
          startedAt: now,
        })
      }
      goal.updatedAt = now
    })
  }

  async handleSubagentStop(input: {
    session_id: string
    agent_id: string
  }): Promise<void> {
    const validSessionId = validateSessionId(input.session_id)
    await this.store.update(validSessionId, state => {
      const goal = state.current
      if (!goal) return
      goal.activeSubagents = goal.activeSubagents.filter(
        agent => agent.id !== input.agent_id,
      )
      if (goal.activeSubagents.length === 0) goal.subagentDeferrals = 0
      goal.updatedAt = this.nowIso()
    })
  }

  async handleStopFailure(input: {
    session_id: string
    transcript_path: string
    error: string
  }): Promise<void> {
    const validSessionId = validateSessionId(input.session_id)
    await this.store.update(validSessionId, state => {
      const nowMs = this.now()
      const now = new Date(nowMs).toISOString()
      this.updateRuntime(state, input.transcript_path, undefined, now)
      const goal = state.current
      if (!goal || goal.status !== 'active') return
      goal.usage.hookFailures += 1
      goal.updatedAt = now
      if (goal.usage.hookFailures >= goal.limits.maxHookFailures) {
        this.settleActiveTime(goal, nowMs)
        goal.status = 'paused'
        goal.stopReason = `Paused after ${goal.usage.hookFailures} consecutive stop failures; latest error: ${input.error}.`
      }
    })
  }

  async handlePostCompact(input: {
    session_id: string
    compact_summary: string
  }): Promise<void> {
    const validSessionId = validateSessionId(input.session_id)
    await this.store.update(validSessionId, state => {
      const goal = state.current
      if (!goal || !isOpen(goal.status)) return
      this.addCheckpoint(goal, summarize(input.compact_summary), 0, this.nowIso())
    })
  }

  async getPreCompactContext(sessionId: string): Promise<string | null> {
    const validSessionId = validateSessionId(sessionId)
    const state = await this.store.read(validSessionId)
    const goal = state?.current
    if (!goal || !isOpen(goal.status)) return null
    return `${buildReminder(validSessionId, goal, this.elapsedMs(goal))}\n\nPreserve this goal context verbatim through compaction.`
  }

  async getReminderContext(sessionId: string): Promise<string | null> {
    const validSessionId = validateSessionId(sessionId)
    const state = await this.store.read(validSessionId)
    const goal = state?.current
    if (!goal || !isOpen(goal.status)) return null
    return buildReminder(validSessionId, goal, this.elapsedMs(goal))
  }

  handlePreToolUse(
    input: PreToolUseHookInput,
  ): PreToolUseHookOutput | null {
    if (!this.defaults.autoApprovePermissions) return null
    if (isPlanMode(input.permission_mode)) return null
    // Verboo applies explicit deny/ask rules after this hook result. Do not
    // alter inputs or install a rule here; PermissionRequest remains the
    // fallback when an explicit ask or canUseTool path still reaches the UI.
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    }
  }

  handlePermissionRequest(
    input: PermissionRequestHookInput,
  ): PermissionRequestHookOutput | null {
    if (!this.defaults.autoApprovePermissions) return null
    if (isPlanMode(input.permission_mode)) return null
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    }
  }

  async handleElicitation(
    input: ElicitationHookInput,
  ): Promise<ElicitationHookOutput | null> {
    if (!(await this.isAutonomousExecution(input))) return null
    return {
      hookSpecificOutput: {
        hookEventName: 'Elicitation',
        action: 'decline',
      },
    }
  }

  async handleStop(input: StopHookInput): Promise<StopHookOutput | null> {
    const validSessionId = validateSessionId(input.session_id)
    return this.store.update(validSessionId, async state => {
      const nowMs = this.now()
      const now = new Date(nowMs).toISOString()
      this.updateRuntime(
        state,
        input.transcript_path,
        input.permission_mode,
        now,
      )
      const goal = state.current
      if (!goal) return null

      let meteringUnavailable: boolean
      let outputTokens = 0
      let latestAssistantId: string | undefined
      let freshMessageCount = 0
      let transcriptReadable = false
      try {
        const usage = await readTranscriptUsage(
          input.transcript_path,
          goal.createdAt,
          goal.accountedMessageIds,
        )
        transcriptReadable = true
        freshMessageCount = usage.newMessageIds.length
        goal.usage.tokens += usage.tokens + usage.estimatedTokens
        outputTokens =
          usage.outputTokens > 0
            ? usage.outputTokens
            : estimateOutputTokens(input.last_assistant_message)
        latestAssistantId = usage.latestAssistantId
        goal.accountedMessageIds = [
          ...new Set([...goal.accountedMessageIds, ...usage.newMessageIds]),
        ].slice(-512)
        if (usage.latestAssistantId) goal.lastAssistantId = usage.latestAssistantId
        if (usage.estimatedTokens > 0) goal.usage.unmeteredTurns += 1
        meteringUnavailable =
          usage.newMessageIds.length > 0 &&
          !usage.usageAvailable &&
          usage.estimatedTokens === 0
      } catch {
        meteringUnavailable = true
      }

      if (terminalOutcome(goal.status)) {
        this.archiveGoal(
          state,
          goal,
          terminalOutcome(goal.status) as HistoryOutcome,
          goal.finishedAt ?? now,
        )
        return null
      }
      if (goal.status === 'paused') return null

      goal.usage.hookFailures = 0
      goal.updatedAt = now

      if (isPlanMode(input.permission_mode)) {
        this.pauseGoal(goal, nowMs, 'Paused because the session is in Plan mode.')
        return {
          systemMessage:
            'Goal paused: automatic execution is disabled in Plan mode.',
        }
      }

      const assistantSummary = summarize(input.last_assistant_message)
      const fingerprint =
        freshMessageCount > 0 && latestAssistantId !== undefined
          ? latestAssistantId
          : createHash('sha256').update(assistantSummary).digest('hex')
      const duplicateWithoutFreshTranscript =
        freshMessageCount === 0 &&
        goal.lastAssistantSummary !== undefined &&
        goal.lastAssistantSummary === assistantSummary

      if (
        goal.lastStopFingerprint === fingerprint ||
        duplicateWithoutFreshTranscript
      ) {
        goal.duplicateStopCount += 1
        if (goal.duplicateStopCount >= 3) {
          this.pauseGoal(
            goal,
            nowMs,
            'Paused after three duplicate Stop events for the same assistant turn.',
          )
          return {
            systemMessage:
              'Goal paused after repeated duplicate Stop events to prevent a loop.',
          }
        }
        return {
          decision: 'block',
          reason: buildContinuationPrompt(
            validSessionId,
            goal,
            this.elapsedMs(goal, nowMs),
          ),
          systemMessage: `Goal active — duplicate Stop event ${goal.duplicateStopCount}/3 ignored for accounting.`,
        }
      }

      if (!transcriptReadable || freshMessageCount === 0) {
        meteringUnavailable = true
      }
      if (meteringUnavailable) {
        goal.usage.unmeteredTurns += 1
        if (goal.limits.tokenBudget !== null) {
          this.pauseGoal(
            goal,
            nowMs,
            'Token usage could not be read from the session transcript.',
          )
          return {
            systemMessage:
              'Goal paused because token usage could not be measured safely.',
          }
        }
        outputTokens = estimateOutputTokens(input.last_assistant_message)
      }

      goal.lastStopFingerprint = fingerprint
      goal.duplicateStopCount = 0
      goal.lastAssistantSummary = assistantSummary
      this.addCheckpoint(goal, assistantSummary, outputTokens, now)

      const elapsedMs = this.elapsedMs(goal, nowMs)
      if (
        goal.limits.tokenBudget !== null &&
        goal.usage.tokens >= goal.limits.tokenBudget
      ) {
        return this.finishAtLimit(
          state,
          goal,
          'budgetLimited',
          `Token budget of ${goal.limits.tokenBudget} reached.`,
          validSessionId,
          nowMs,
        )
      }
      if (
        goal.limits.maxDurationSeconds !== null &&
        elapsedMs >= goal.limits.maxDurationSeconds * 1_000
      ) {
        return this.finishAtLimit(
          state,
          goal,
          'usageLimited',
          `Active-time limit of ${goal.limits.maxDurationSeconds} seconds reached.`,
          validSessionId,
          nowMs,
        )
      }

      if (
        goal.limits.deferWhileSubagentsActive &&
        goal.activeSubagents.length > 0
      ) {
        goal.subagentDeferrals += 1
        if (goal.subagentDeferrals >= goal.limits.maxSubagentDeferrals) {
          this.pauseGoal(
            goal,
            nowMs,
            'Paused after child agents remained active across three Stop events.',
          )
          return {
            systemMessage:
              'Goal paused because child-agent state did not settle after three checks.',
          }
        }
        return {
          decision: 'block',
          reason: buildSubagentWaitPrompt(
            validSessionId,
            goal,
            this.elapsedMs(goal, nowMs),
          ),
          systemMessage: `Goal waiting for ${goal.activeSubagents.length} active child agent(s).`,
        }
      }
      goal.subagentDeferrals = 0

      if (!goal.limits.autoContinue) return null
      if (goal.usage.autoTurns >= goal.limits.maxAutoTurns) {
        return this.finishAtLimit(
          state,
          goal,
          'usageLimited',
          `Automatic-turn limit of ${goal.limits.maxAutoTurns} reached.`,
          validSessionId,
          nowMs,
        )
      }

      if (goal.usage.autoTurns > 0) {
        goal.usage.noProgressTurns =
          outputTokens < goal.limits.noProgressTokenThreshold
            ? goal.usage.noProgressTurns + 1
            : 0
        if (goal.usage.noProgressTurns >= goal.limits.maxNoProgressTurns) {
          this.pauseGoal(
            goal,
            nowMs,
            `Paused after ${goal.usage.noProgressTurns} consecutive low-progress turns.`,
          )
          return {
            systemMessage:
              'Goal paused after repeated low-progress turns to prevent an empty loop.',
          }
        }
      }

      goal.usage.autoTurns += 1
      goal.updatedAt = now
      return {
        decision: 'block',
        reason: buildContinuationPrompt(
          validSessionId,
          goal,
          this.elapsedMs(goal, nowMs),
        ),
        systemMessage: `Goal active — automatic turn ${goal.usage.autoTurns}/${goal.limits.maxAutoTurns}.`,
      }
    })
  }

  private async recordContext(
    sessionId: string,
    transcriptPath: string,
    permissionMode: string | undefined,
    pauseInPlan: boolean,
  ): Promise<GoalView | null> {
    const validSessionId = validateSessionId(sessionId)
    return this.store.update(validSessionId, state => {
      const nowMs = this.now()
      const now = new Date(nowMs).toISOString()
      this.updateRuntime(state, transcriptPath, permissionMode, now)
      const goal = state.current
      if (!goal) return null
      if (pauseInPlan && goal.status === 'active' && isPlanMode(permissionMode)) {
        this.pauseGoal(goal, nowMs, 'Paused because the session entered Plan mode.')
      }
      return this.toView(goal, validSessionId)
    })
  }

  /**
   * Tool permission and MCP elicitation hooks need a current answer, not a
   * lifecycle transition. Keep this as a snapshot read so it cannot contend
   * with normal state writes or update runtime metadata on every tool call.
   */
  private async isAutonomousExecution(input: {
    session_id: string
    permission_mode?: string
  }): Promise<boolean> {
    if (!this.defaults.autoApprovePermissions) return false
    // An explicit current mode is authoritative and lets Plan mode bypass even
    // an unavailable snapshot without producing an autonomy decision.
    if (isPlanMode(input.permission_mode)) return false

    const validSessionId = validateSessionId(input.session_id)
    const state = await this.store.readForAutonomy(validSessionId)
    const permissionMode = input.permission_mode ?? state?.runtime.permissionMode
    if (isPlanMode(permissionMode)) return false
    return state?.current?.status === 'active'
  }

  private updateRuntime(
    state: SessionState,
    transcriptPath: string | undefined,
    permissionMode: string | undefined,
    now: string,
  ): void {
    state.runtime.updatedAt = now
    if (transcriptPath !== undefined && transcriptPath.length > 0) {
      state.runtime.transcriptPath = transcriptPath
    }
    if (permissionMode !== undefined && permissionMode.length > 0) {
      state.runtime.permissionMode = permissionMode
    }
  }

  private pauseGoal(goal: GoalRecord, nowMs: number, reason: string): void {
    this.settleActiveTime(goal, nowMs)
    goal.status = 'paused'
    goal.stopReason = reason
    goal.updatedAt = new Date(nowMs).toISOString()
  }

  private settleActiveTime(goal: GoalRecord, nowMs: number): void {
    if (!goal.activeSince) return
    const activeSince = Date.parse(goal.activeSince)
    if (Number.isFinite(activeSince) && nowMs > activeSince) {
      goal.usage.accumulatedActiveMs += Math.trunc(nowMs - activeSince)
    }
    delete goal.activeSince
  }

  private elapsedMs(goal: GoalRecord, nowMs = this.now()): number {
    if (!goal.activeSince) return goal.usage.accumulatedActiveMs
    const activeSince = Date.parse(goal.activeSince)
    return Number.isFinite(activeSince) && nowMs > activeSince
      ? goal.usage.accumulatedActiveMs + Math.trunc(nowMs - activeSince)
      : goal.usage.accumulatedActiveMs
  }

  private addCheckpoint(
    goal: GoalRecord,
    summary: string,
    outputTokens: number,
    now: string,
    extra?: {
      evidence?: string[]
      facts?: string[]
      contradictions?: string[]
      verification?: string[]
    },
  ): void {
    goal.checkpoints = [
      ...goal.checkpoints,
      {
        at: now,
        summary: summarize(summary),
        outputTokens,
        ...(extra?.evidence?.length ? { evidence: extra.evidence } : {}),
        ...(extra?.facts?.length ? { facts: extra.facts } : {}),
        ...(extra?.contradictions?.length ? { contradictions: extra.contradictions } : {}),
        ...(extra?.verification?.length ? { verification: extra.verification } : {}),
      },
    ].slice(-8)
    goal.updatedAt = now
  }

  async reportCheckpoint(
    sessionId: string,
    summary: string,
    extra?: {
      evidence?: string[]
      facts?: string[]
      contradictions?: string[]
      verification?: string[]
    },
  ): Promise<GoalView> {
    const validSessionId = validateSessionId(sessionId)
    return await this.store.update(validSessionId, state => {
      const goal = state.current
      if (!goal) throw new GoalError('NO_ACTIVE_GOAL', 'No active goal in this session.')
      this.addCheckpoint(goal, summary, 0, this.nowIso(), extra)
      return this.toView(goal, validSessionId)
    })
  }

  private archiveGoal(
    state: SessionState,
    goal: GoalRecord,
    outcome: HistoryOutcome,
    finishedAt: string,
  ): void {
    const entry: GoalHistoryEntry = {
      goalId: goal.id,
      outcome,
      objective: goal.objective,
      status: goal.status,
      limits: { ...goal.limits },
      usage: cloneUsage(goal),
      createdAt: goal.createdAt,
      finishedAt,
      recordedAt: this.nowIso(),
      checkpoints: goal.checkpoints.map(checkpoint => ({ ...checkpoint })),
    }
    if (goal.evidence !== undefined) entry.evidence = goal.evidence
    if (goal.blocker !== undefined) entry.blocker = goal.blocker
    if (goal.stopReason !== undefined) entry.stopReason = goal.stopReason

    const existing = state.history.findIndex(item => item.goalId === goal.id)
    if (existing >= 0) state.history.splice(existing, 1)
    state.history = [entry, ...state.history].slice(0, 50)
  }

  private finishAtLimit(
    state: SessionState,
    goal: GoalRecord,
    status: 'budgetLimited' | 'usageLimited',
    reason: string,
    sessionId: string,
    nowMs: number,
  ): StopHookOutput {
    this.settleActiveTime(goal, nowMs)
    const now = new Date(nowMs).toISOString()
    goal.status = status
    goal.stopReason = reason
    goal.finishedAt = now
    goal.updatedAt = now
    goal.wrapUpIssued = true
    this.archiveGoal(state, goal, status, now)
    return {
      decision: 'block',
      reason: buildWrapUpPrompt(
        sessionId,
        goal,
        this.elapsedMs(goal, nowMs),
      ),
      systemMessage: `Goal stopped by safety limit: ${reason}`,
    }
  }

  private toView(goal: GoalRecord, sessionId: string): GoalView {
    const view: GoalView = {
      sessionId,
      goalId: goal.id,
      objective: goal.objective,
      status: goal.status,
      limits: { ...goal.limits },
      usage: { ...goal.usage, elapsedMs: this.elapsedMs(goal) },
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      checkpoints: goal.checkpoints.map(c => ({ ...c })),
      activeSubagents: goal.activeSubagents.map(agent => ({ ...agent })),
    }
    if (goal.finishedAt !== undefined) view.finishedAt = goal.finishedAt
    if (goal.evidence !== undefined) view.evidence = goal.evidence
    if (goal.blocker !== undefined) view.blocker = goal.blocker
    if (goal.stopReason !== undefined) view.stopReason = goal.stopReason
    const checkpoint = goal.checkpoints.at(-1)
    if (checkpoint) view.lastCheckpoint = { ...checkpoint }
    return view
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString()
  }
}

const validateSessionId = (sessionId: string): string => {
  const normalized = sessionId.trim()
  if (normalized.length === 0 || normalized.length > 256) {
    throw new GoalError(
      'VALIDATION_ERROR',
      'session_id must contain between 1 and 256 characters.',
    )
  }
  return normalized
}

const requireOpenGoal = (state: SessionState): GoalRecord => {
  if (!state.current) {
    throw new GoalError('NO_ACTIVE_GOAL', 'This session has no goal.')
  }
  if (!isOpen(state.current.status)) {
    throw new GoalError(
      'INVALID_TRANSITION',
      `Goal ${state.current.id} is already ${state.current.status}.`,
    )
  }
  return state.current
}
