import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { GoalError } from '../src/core/errors.js'
import { GoalStore } from '../src/core/store.js'
import { createTestContext, type TestContext } from './helpers.js'

describe('goal store', () => {
  let context: TestContext | undefined
  afterEach(async () => context?.cleanup())

  test('hashes session ids and round-trips state', async () => {
    context = await createTestContext()
    expect(context.store.sessionPath('secret-session')).not.toContain(
      'secret-session',
    )
    await context.store.update('secret-session', state => {
      state.runtime.permissionMode = 'default'
    })
    const state = await context.store.read('secret-session')
    expect(state?.sessionId).toBe('secret-session')
    expect(state?.runtime.permissionMode).toBe('default')
  })

  test('serializes concurrent writers with a per-session lock', async () => {
    context = await createTestContext()
    await context.service.createGoal('session', { objective: 'Concurrency test' })
    await Promise.all(
      Array.from({ length: 12 }, () =>
        context?.store.update('session', state => {
          if (state.current) state.current.usage.tokens += 1
        }),
      ),
    )
    expect((await context.store.read('session'))?.current?.usage.tokens).toBe(12)
  })

  test('fails without overwriting corrupt state', async () => {
    context = await createTestContext()
    await context.store.update('session', () => undefined)
    const path = context.store.sessionPath('session')
    await writeFile(path, '{broken')
    await expect(context.store.read('session')).rejects.toBeInstanceOf(GoalError)
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })

  test('recovers a stale lock directory', async () => {
    context = await createTestContext()
    const store = new GoalStore(context.dataDir, {
      lockTimeoutMs: 200,
      staleLockMs: 1,
      retryDelayMs: 1,
    })
    const lockPath = `${store.sessionPath('session')}.lock`
    await mkdir(lockPath, { recursive: true })
    const old = new Date(Date.now() - 60_000)
    await utimes(lockPath, old, old)
    await store.update('session', state => {
      state.runtime.permissionMode = 'default'
    })
    expect((await store.read('session'))?.runtime.permissionMode).toBe('default')
  })
})
