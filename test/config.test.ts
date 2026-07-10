import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadPersistedGoalConfig,
  savePersistedGoalConfig,
} from '../src/core/config-file.js'
import { loadDefaultGoalConfig } from '../src/core/config.js'

describe('goal configuration', () => {
  let dataDir: string | undefined
  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  test('reads Verboo plugin option environment variables', () => {
    const config = loadDefaultGoalConfig({
      CLAUDE_PLUGIN_OPTION_AUTO_CONTINUE: 'false',
      CLAUDE_PLUGIN_OPTION_DEFER_WHILE_SUBAGENTS_ACTIVE: 'false',
      CLAUDE_PLUGIN_OPTION_MAX_AUTO_TURNS: '7',
      CLAUDE_PLUGIN_OPTION_DEFAULT_TOKEN_BUDGET: '1234',
      CLAUDE_PLUGIN_OPTION_MAX_GOAL_DURATION_SECONDS: '90',
      CLAUDE_PLUGIN_OPTION_NO_PROGRESS_TOKEN_THRESHOLD: '12',
      CLAUDE_PLUGIN_OPTION_MAX_NO_PROGRESS_TURNS: '4',
      CLAUDE_PLUGIN_OPTION_MAX_HOOK_FAILURES: '5',
    })

    expect(config).toMatchObject({
      autoContinue: false,
      deferWhileSubagentsActive: false,
      maxAutoTurns: 7,
      defaultTokenBudget: 1_234,
      maxDurationSeconds: 90,
      noProgressTokenThreshold: 12,
      maxNoProgressTurns: 4,
      maxHookFailures: 5,
    })
  })

  test('round-trips persisted defaults for the MCP process', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'verboo-goal-config-'))
    const defaults = loadDefaultGoalConfig({
      CLAUDE_PLUGIN_OPTION_MAX_AUTO_TURNS: '9',
      CLAUDE_PLUGIN_OPTION_DEFAULT_TOKEN_BUDGET: '4567',
    })
    await savePersistedGoalConfig(dataDir, defaults)
    expect(await loadPersistedGoalConfig(dataDir, {})).toEqual(defaults)
  })
})
