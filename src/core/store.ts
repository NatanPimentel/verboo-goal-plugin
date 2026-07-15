import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { GoalError } from './errors.js'
import { sessionStateSchema, sessionStateSchemaV1 } from './schema.js'
import type { GoalHistoryEntry, GoalRecord, SessionState } from './types.js'

interface GoalStoreOptions {
  lockTimeoutMs?: number
  staleLockMs?: number
  retryDelayMs?: number
  now?: () => number
}

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const bestEffortChmod = async (path: string, mode: number): Promise<void> => {
  try {
    await chmod(path, mode)
  } catch {
    // Windows does not consistently implement POSIX modes.
  }
}

export const createEmptySessionState = (
  sessionId: string,
  now = new Date().toISOString(),
): SessionState => ({
  schemaVersion: 2,
  sessionId,
  runtime: { updatedAt: now },
  current: null,
  stack: [],
  history: [],
})

const migrateV1ToV2 = (state: unknown): SessionState => {
  const v1 = state as {
    sessionId: string
    runtime: { updatedAt: string; permissionMode?: string; transcriptPath?: string }
    current: GoalRecord | null
    history: GoalHistoryEntry[]
  }
  return {
    schemaVersion: 2,
    sessionId: v1.sessionId,
    runtime: {
      updatedAt: v1.runtime.updatedAt,
      ...(v1.runtime.permissionMode !== undefined
        ? { permissionMode: v1.runtime.permissionMode }
        : {}),
      ...(v1.runtime.transcriptPath !== undefined
        ? { transcriptPath: v1.runtime.transcriptPath }
        : {}),
    },
    current: v1.current
      ? ({ ...v1.current, tasks: [], nextTaskId: 1 } as GoalRecord)
      : null,
    stack: [],
    history: v1.history.map(entry => ({ ...entry, tasks: [] }) as GoalHistoryEntry),
  }
}

export class GoalStore {
  readonly dataDir: string
  private readonly goalsDir: string
  private readonly lockTimeoutMs: number
  private readonly staleLockMs: number
  private readonly retryDelayMs: number
  private readonly now: () => number

  constructor(dataDir: string, options: GoalStoreOptions = {}) {
    if (dataDir.trim().length === 0) {
      throw new GoalError(
        'VALIDATION_ERROR',
        'The plugin data directory is not configured.',
      )
    }
    this.dataDir = dataDir
    this.goalsDir = join(dataDir, 'goals')
    this.lockTimeoutMs = options.lockTimeoutMs ?? 3_000
    this.staleLockMs = options.staleLockMs ?? 30_000
    this.retryDelayMs = options.retryDelayMs ?? 25
    this.now = options.now ?? Date.now
  }

  sessionKey(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex')
  }

  sessionPath(sessionId: string): string {
    return join(this.goalsDir, `${this.sessionKey(sessionId)}.json`)
  }

  async read(sessionId: string): Promise<SessionState | null> {
    await this.ensureDirectory()
    return this.readUnlocked(sessionId)
  }

  /**
   * Read an existing session for latency-sensitive autonomy hooks.
   *
   * This deliberately does not create directories, acquire a lock, chmod
   * anything, or rewrite the state. Lifecycle handlers remain responsible for
   * persistence; permission and elicitation hooks only need a snapshot.
   */
  async readForAutonomy(sessionId: string): Promise<SessionState | null> {
    const dataDirectory = await this.autonomyDirectory(this.dataDir)
    if (!dataDirectory) return null
    const goalsDirectory = await this.autonomyDirectory(this.goalsDir)
    if (!goalsDirectory) return null
    return this.readUnlocked(sessionId)
  }

  async update<T>(
    sessionId: string,
    updater: (state: SessionState) => T | Promise<T>,
  ): Promise<T> {
    await this.ensureDirectory()
    const release = await this.acquireLock(sessionId)
    try {
      const state =
        (await this.readUnlocked(sessionId)) ??
        createEmptySessionState(sessionId, new Date(this.now()).toISOString())
      const result = await updater(state)
      await this.writeUnlocked(sessionId, state)
      return result
    } finally {
      await release()
    }
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.goalsDir, { recursive: true, mode: 0o700 })
    await bestEffortChmod(this.dataDir, 0o700)
    await bestEffortChmod(this.goalsDir, 0o700)
  }

  /**
   * A missing directory simply means this session has no persisted state yet.
   * A path that exists but is not a directory (or cannot be inspected) is an
   * unavailable store and must reach the hook's fail-closed path.
   */
  private async autonomyDirectory(path: string): Promise<boolean> {
    let details: Awaited<ReturnType<typeof stat>>
    try {
      details = await stat(path)
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
    if (details.isDirectory()) return true
    throw new GoalError(
      'STATE_UNAVAILABLE',
      `Goal state directory is unavailable: ${path}`,
    )
  }

  private async readUnlocked(sessionId: string): Promise<SessionState | null> {
    const path = this.sessionPath(sessionId)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }

    try {
      const parsed = JSON.parse(raw)
      if (parsed.schemaVersion === 1) {
        const v1 = sessionStateSchemaV1.parse(parsed)
        if (v1.sessionId !== sessionId) {
          throw new Error('Session identifier does not match the file key.')
        }
        return sessionStateSchema.parse(migrateV1ToV2(v1))
      }
      const state = sessionStateSchema.parse(parsed) as SessionState
      if (state.sessionId !== sessionId) {
        throw new Error('Session identifier does not match the file key.')
      }
      return state
    } catch (error) {
      throw new GoalError(
        'CORRUPT_STATE',
        `Goal state is corrupt and was left untouched: ${path}`,
        {
          cause: error instanceof Error ? error.message : String(error),
          path,
        },
      )
    }
  }

  private async writeUnlocked(
    sessionId: string,
    state: SessionState,
  ): Promise<void> {
    const parsed = sessionStateSchema.parse(state)
    const target = this.sessionPath(sessionId)
    const temporary = join(
      this.goalsDir,
      `.${this.sessionKey(sessionId)}.${process.pid}.${randomUUID()}.tmp`,
    )

    try {
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await rename(temporary, target)
      await bestEffortChmod(target, 0o600)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async acquireLock(sessionId: string): Promise<() => Promise<void>> {
    const lockPath = join(
      this.goalsDir,
      `${this.sessionKey(sessionId)}.json.lock`,
    )
    const startedAt = this.now()

    while (this.now() - startedAt <= this.lockTimeoutMs) {
      try {
        await mkdir(lockPath, { mode: 0o700 })
        await writeFile(
          join(lockPath, 'owner.json'),
          JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
          { encoding: 'utf8', mode: 0o600 },
        )
        return async () => {
          await rm(lockPath, { recursive: true, force: true })
        }
      } catch (error) {
        const code =
          error instanceof Error && 'code' in error ? error.code : undefined
        if (code !== 'EEXIST') {
          throw error
        }

        try {
          const lockStat = await stat(lockPath)
          if (this.now() - lockStat.mtimeMs > this.staleLockMs) {
            const stalePath = `${lockPath}.stale.${randomUUID()}`
            try {
              await rename(lockPath, stalePath)
              await rm(stalePath, { recursive: true, force: true })
              continue
            } catch (renameError) {
              const code =
                renameError instanceof Error && 'code' in renameError
                  ? renameError.code
                  : undefined
              if (code !== 'ENOENT' && code !== 'EPERM' && code !== 'EACCES') {
                throw renameError
              }
            }
          }
        } catch (statError) {
          if (!isMissing(statError)) throw statError
        }

        await sleep(this.retryDelayMs)
      }
    }

    throw new GoalError(
      'LOCK_TIMEOUT',
      `Timed out waiting for the goal state lock for session ${sessionId}.`,
    )
  }
}
