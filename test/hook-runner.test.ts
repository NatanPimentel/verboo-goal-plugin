import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import { assistantLine, createTestContext, type TestContext } from './helpers.js'

interface ProcessResult {
  code: number | null
  stdout: string
  stderr: string
}

const runBundledHook = async (
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/hook-runner.mjs'], {
      cwd: process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('close', code => resolve({ code, stdout, stderr }))
    child.stdin.end(JSON.stringify(input))
  })

describe('bundled hook runner', () => {
  let context: TestContext | undefined
  afterEach(async () => context?.cleanup())

  test('persists Verboo options and blocks Stop for an active goal', async () => {
    context = await createTestContext()
    await context.service.createGoal('hook-session', {
      objective: 'Exercise the packaged Stop adapter',
    })
    context.clock.now += 1_000
    await appendFile(
      context.transcriptPath,
      `${assistantLine('hook-turn', context.clock.now, {
        input: 100,
        output: 100,
      })}\n`,
    )

    const result = await runBundledHook(
      {
        session_id: 'hook-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'Stop',
        stop_hook_active: false,
        permission_mode: 'default',
        last_assistant_message: 'Completed a meaningful implementation step.',
      },
      {
        ...process.env,
        CLAUDE_PLUGIN_DATA: context.dataDir,
        CLAUDE_PLUGIN_OPTION_MAX_AUTO_TURNS: '7',
      },
    )

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ decision: 'block' })
    const persisted = JSON.parse(
      await readFile(`${context.dataDir}/config.json`, 'utf8'),
    ) as { defaults: { maxAutoTurns: number } }
    expect(persisted.defaults.maxAutoTurns).toBe(7)
    expect((await context.service.getGoal('hook-session'))?.usage.autoTurns).toBe(
      1,
    )
  })
})
