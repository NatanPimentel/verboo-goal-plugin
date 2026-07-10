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
import { sessionStateSchema } from './schema.js'
import type { SessionState } from './types.js'

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
  schemaVersion: 1,
  sessionId,
  runtime: { updatedAt: now },
  current: null,
  history: [],
})

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
      const state = sessionStateSchema.parse(JSON.parse(raw)) as SessionState
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
