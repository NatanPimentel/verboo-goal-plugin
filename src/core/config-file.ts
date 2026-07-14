import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { loadDefaultGoalConfig } from './config.js'
import type { DefaultGoalConfig } from './types.js'

const defaultsSchema = z
  .object({
    autoApprovePermissions: z.boolean(),
    autoContinue: z.boolean(),
    deferWhileSubagentsActive: z.boolean(),
    maxAutoTurns: z.number().int().min(1).max(100),
    defaultTokenBudget: z.number().int().positive().max(10_000_000).nullable(),
    maxDurationSeconds: z.number().int().positive().max(86_400).nullable(),
    noProgressTokenThreshold: z.number().int().min(0).max(1_000),
    maxNoProgressTurns: z.number().int().min(1).max(10),
    maxHookFailures: z.number().int().min(1).max(10),
    maxSubagentDeferrals: z.number().int().min(1).max(10),
  })
  .strict()

const configFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    defaults: defaultsSchema,
  })
  .strict()

const configPath = (dataDir: string): string => join(dataDir, 'config.json')

const bestEffortChmod = async (path: string, mode: number): Promise<void> => {
  try {
    await chmod(path, mode)
  } catch {
    // POSIX modes are best-effort on Windows.
  }
}

export const savePersistedGoalConfig = async (
  dataDir: string,
  defaults: DefaultGoalConfig,
): Promise<void> => {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const target = configPath(dataDir)
  const temporary = join(
    dataDir,
    `.config.${process.pid}.${randomUUID()}.tmp`,
  )
  const payload = configFileSchema.parse({ schemaVersion: 1, defaults })
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await rename(temporary, target)
    await bestEffortChmod(dataDir, 0o700)
    await bestEffortChmod(target, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export const loadPersistedGoalConfig = async (
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DefaultGoalConfig> => {
  try {
    const raw = await readFile(configPath(dataDir), 'utf8')
    return configFileSchema.parse(JSON.parse(raw)).defaults
  } catch {
    return loadDefaultGoalConfig(env)
  }
}
