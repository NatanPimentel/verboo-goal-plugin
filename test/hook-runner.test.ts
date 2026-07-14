import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createTestContext, type TestContext } from './helpers.js'

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

  test('persists updated Verboo options on UserPromptSubmit and SessionStart', async () => {
    context = await createTestContext()
    await context.service.createGoal('hook-session', {
      objective: 'Exercise the packaged configuration adapter',
    })

    const submitted = await runBundledHook(
      {
        session_id: 'hook-session',
        transcript_path: context.transcriptPath,
        hook_event_name: 'UserPromptSubmit',
        permission_mode: 'default',
      },
      {
        ...process.env,
        CLAUDE_PLUGIN_DATA: context.dataDir,
        CLAUDE_PLUGIN_OPTION_MAX_AUTO_TURNS: '7',
      },
    )

    expect(submitted.code).toBe(0)
    expect(submitted.stderr).toBe('')
    expect(JSON.parse(submitted.stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    })
    const afterPrompt = JSON.parse(
      await readFile(`${context.dataDir}/config.json`, 'utf8'),
    ) as { defaults: { maxAutoTurns: number } }
    expect(afterPrompt.defaults.maxAutoTurns).toBe(7)

    const resumed = await runBundledHook(
      {
        session_id: 'hook-session',
        transcript_path: context.transcriptPath,
        hook_event_name: 'SessionStart',
        source: 'resume',
      },
      {
        ...process.env,
        CLAUDE_PLUGIN_DATA: context.dataDir,
        CLAUDE_PLUGIN_OPTION_MAX_AUTO_TURNS: '8',
      },
    )
    expect(resumed.code).toBe(0)
    expect(resumed.stderr).toBe('')
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    })
    const afterResume = JSON.parse(
      await readFile(`${context.dataDir}/config.json`, 'utf8'),
    ) as { defaults: { maxAutoTurns: number } }
    expect(afterResume.defaults.maxAutoTurns).toBe(8)
  })

  test('uses bundled autonomy hooks without rewriting configuration or tool input', async () => {
    context = await createTestContext()
    await context.service.createGoal('permission-session', {
      objective: 'Exercise autonomy hooks without global permission rules',
    })

    const preTool = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: 'C:\\outside-workspace',
        hook_event_name: 'PreToolUse',
        permission_mode: 'default',
        tool_name: 'mcp__remote__tool',
        tool_use_id: 'tool-use-1',
        tool_input: {
          command: 'Remove-Item -Recurse C:\\outside-workspace',
          nested: { preserve: true },
        },
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    expect(preTool.code).toBe(0)
    expect(preTool.stderr).toBe('')
    expect(JSON.parse(preTool.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    })

    const permission = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: 'C:\\outside-workspace',
        hook_event_name: 'PermissionRequest',
        permission_mode: 'default',
        tool_name: 'mcp__remote__tool',
        tool_input: { command: 'Remove-Item -Recurse C:\\outside-workspace' },
        permission_suggestions: [{ type: 'addRules', rules: ['Bash(*)'] }],
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    expect(permission.code).toBe(0)
    expect(permission.stderr).toBe('')
    expect(JSON.parse(permission.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    })

    const form = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'Elicitation',
        permission_mode: 'default',
        mcp_server_name: 'remote-mcp',
        message: 'Choose an account.',
        mode: 'form',
        requested_schema: {
          type: 'object',
          properties: { account: { type: 'string' } },
        },
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    const url = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'Elicitation',
        permission_mode: 'default',
        mcp_server_name: 'remote-mcp',
        message: 'Open this authorization page.',
        mode: 'url',
        url: 'https://auth.example.test/authorize',
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    const declined = {
      hookSpecificOutput: {
        hookEventName: 'Elicitation',
        action: 'decline',
      },
    }
    expect(form.code).toBe(0)
    expect(form.stderr).toBe('')
    expect(JSON.parse(form.stdout)).toEqual(declined)
    expect(url.code).toBe(0)
    expect(url.stderr).toBe('')
    expect(JSON.parse(url.stdout)).toEqual(declined)

    await expect(
      readFile(`${context.dataDir}/config.json`, 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('fails closed for corrupt goal state without directing a repair request', async () => {
    context = await createTestContext()
    await context.service.createGoal('permission-session', {
      objective: 'Exercise fail-closed autonomy hooks',
    })
    await writeFile(context.store.sessionPath('permission-session'), '{broken')

    const preTool = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'PreToolUse',
        permission_mode: 'default',
        tool_name: 'powershell',
        tool_use_id: 'corrupt-tool-use',
        tool_input: { command: 'Get-ChildItem' },
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    const permission = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'PermissionRequest',
        permission_mode: 'default',
        tool_name: 'powershell',
        tool_input: { command: 'Get-ChildItem' },
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    const elicitation = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'Elicitation',
        permission_mode: 'default',
        mcp_server_name: 'remote-mcp',
        message: 'Choose an account.',
        mode: 'form',
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )

    const preToolOutput = JSON.parse(preTool.stdout) as {
      hookSpecificOutput: {
        permissionDecision: string
        permissionDecisionReason: string
      }
    }
    const permissionOutput = JSON.parse(permission.stdout) as {
      hookSpecificOutput: {
        decision: { behavior: string; message: string }
      }
    }
    const elicitationOutput = JSON.parse(elicitation.stdout) as {
      hookSpecificOutput: { action: string }
      systemMessage: string
    }

    expect(preTool.code).toBe(0)
    expect(preToolOutput.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(preToolOutput.hookSpecificOutput.permissionDecisionReason).toContain(
      'fail-closed',
    )
    expect(preToolOutput.hookSpecificOutput.permissionDecisionReason).toContain(
      'safe alternative',
    )
    expect(preToolOutput.hookSpecificOutput.permissionDecisionReason).toContain(
      'do not repeat the same request indefinitely',
    )
    expect(preToolOutput.hookSpecificOutput.permissionDecisionReason).not.toContain(
      'repair',
    )
    expect(permission.code).toBe(0)
    expect(permissionOutput.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(permissionOutput.hookSpecificOutput.decision.message).toContain(
      'fail-closed',
    )
    expect(permissionOutput.hookSpecificOutput.decision.message).toContain(
      'safe alternative',
    )
    expect(permissionOutput.hookSpecificOutput.decision.message).toContain(
      'do not repeat the same request indefinitely',
    )
    expect(permissionOutput.hookSpecificOutput.decision.message).not.toContain(
      'repair',
    )
    expect(elicitation.code).toBe(0)
    expect(elicitationOutput.hookSpecificOutput.action).toBe('decline')
    expect(elicitationOutput.systemMessage).toContain('fail-closed')
    expect(elicitationOutput.systemMessage).toContain('safe alternative')
    expect(elicitationOutput.systemMessage).toContain(
      'do not repeat the same request indefinitely',
    )
    expect(elicitationOutput.systemMessage).not.toContain('repair')
  })

  test('uses normal permissions outside active goals and skips Plan-mode state reads', async () => {
    context = await createTestContext()

    const noGoal = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'PermissionRequest',
        permission_mode: 'default',
        tool_name: 'powershell',
        tool_input: { command: 'Get-ChildItem' },
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    expect(noGoal.stdout).toBe('')

    await context.service.createGoal('permission-session', {
      objective: 'Remain active in Plan mode',
    })
    const planMode = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'PermissionRequest',
        permission_mode: 'plan',
        tool_name: 'powershell',
        tool_input: { command: 'Get-ChildItem' },
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: context.dataDir },
    )
    expect(planMode.stdout).toBe('')
    expect((await context.service.getGoal('permission-session'))?.status).toBe(
      'active',
    )

    const unavailablePath = `${context.dataDir}/unavailable-in-plan`
    await writeFile(unavailablePath, 'not a directory')
    const unavailablePlan = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'Elicitation',
        permission_mode: 'plan',
        mcp_server_name: 'remote-mcp',
        message: 'Choose an account.',
        mode: 'form',
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: unavailablePath },
    )
    expect(unavailablePlan.code).toBe(0)
    expect(unavailablePlan.stderr).toBe('')
    expect(unavailablePlan.stdout).toBe('')
  })

  test('leaves all permission decisions to Verboo when disabled', async () => {
    context = await createTestContext()
    await context.service.createGoal('permission-session', {
      objective: 'Keep permissions manual',
    })

    const result = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'PermissionRequest',
        permission_mode: 'default',
        tool_name: 'powershell',
        tool_input: { command: 'Get-ChildItem' },
      },
      {
        ...process.env,
        CLAUDE_PLUGIN_DATA: context.dataDir,
        CLAUDE_PLUGIN_OPTION_AUTO_APPROVE_PERMISSIONS: 'false',
      },
    )

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('')
    expect((await context.service.getGoal('permission-session'))?.status).toBe(
      'active',
    )
  })

  test('fails closed when the autonomy store is unavailable', async () => {
    context = await createTestContext()
    const unavailablePath = `${context.dataDir}/unavailable`
    await writeFile(unavailablePath, 'not a directory')

    const permission = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'PermissionRequest',
        permission_mode: 'default',
        tool_name: 'powershell',
        tool_input: { command: 'Get-ChildItem' },
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: unavailablePath },
    )
    const elicitation = await runBundledHook(
      {
        session_id: 'permission-session',
        transcript_path: context.transcriptPath,
        cwd: context.dataDir,
        hook_event_name: 'Elicitation',
        permission_mode: 'default',
        mcp_server_name: 'remote-mcp',
        message: 'Open this authorization page.',
        mode: 'url',
        url: 'https://auth.example.test/authorize',
      },
      { ...process.env, CLAUDE_PLUGIN_DATA: unavailablePath },
    )

    const permissionOutput = JSON.parse(permission.stdout) as {
      hookSpecificOutput: { decision: { behavior: string; message: string } }
    }
    const elicitationOutput = JSON.parse(elicitation.stdout) as {
      hookSpecificOutput: { action: string }
      systemMessage: string
    }
    expect(permission.code).toBe(0)
    expect(permissionOutput.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(permissionOutput.hookSpecificOutput.decision.message).toContain(
      'safe alternative',
    )
    expect(permissionOutput.hookSpecificOutput.decision.message).not.toContain(
      'repair',
    )
    expect(elicitation.code).toBe(0)
    expect(elicitationOutput.hookSpecificOutput.action).toBe('decline')
    expect(elicitationOutput.systemMessage).toContain('fail-closed')
    expect(elicitationOutput.systemMessage).toContain('safe alternative')
    expect(elicitationOutput.systemMessage).not.toContain('repair')
  })
})
