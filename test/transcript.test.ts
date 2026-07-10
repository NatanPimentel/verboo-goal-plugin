import { afterEach, describe, expect, test } from 'bun:test'
import { appendFile, writeFile } from 'node:fs/promises'
import { readTranscriptUsage } from '../src/core/transcript.js'
import { assistantLine, createTestContext, type TestContext } from './helpers.js'

describe('transcript usage', () => {
  let context: TestContext | undefined
  afterEach(async () => context?.cleanup())

  test('deduplicates streamed records by assistant message id', async () => {
    context = await createTestContext()
    const createdAt = new Date(context.clock.now).toISOString()
    await appendFile(
      context.transcriptPath,
      `${assistantLine('message-1', context.clock.now + 1_000, { input: 100, output: 20 })}\n`,
    )
    await appendFile(
      context.transcriptPath,
      `${assistantLine('message-1', context.clock.now + 2_000, {
        input: 120,
        output: 40,
        cacheCreation: 10,
        cacheRead: 30,
      })}\n`,
    )

    const usage = await readTranscriptUsage(
      context.transcriptPath,
      createdAt,
      [],
    )
    expect(usage.tokens).toBe(200)
    expect(usage.outputTokens).toBe(40)
    expect(usage.newMessageIds).toEqual(['message-1'])
    expect(usage.latestAssistantId).toBe('message-1')
  })

  test('ignores old and already-accounted messages', async () => {
    context = await createTestContext()
    await writeFile(
      context.transcriptPath,
      [
        assistantLine('old', context.clock.now - 1_000),
        assistantLine('accounted', context.clock.now + 1_000),
        assistantLine('fresh', context.clock.now + 2_000, {
          input: 10,
          output: 5,
        }),
      ].join('\n'),
    )
    const usage = await readTranscriptUsage(
      context.transcriptPath,
      new Date(context.clock.now).toISOString(),
      ['accounted'],
    )
    expect(usage.tokens).toBe(15)
    expect(usage.newMessageIds).toEqual(['fresh'])
  })

  test('skips malformed lines without crashing', async () => {
    context = await createTestContext()
    await writeFile(
      context.transcriptPath,
      `{not json assistant}\n${assistantLine('fresh', context.clock.now + 1_000)}`,
    )
    const usage = await readTranscriptUsage(
      context.transcriptPath,
      new Date(context.clock.now).toISOString(),
      [],
    )
    expect(usage.malformedLines).toBe(1)
    expect(usage.tokens).toBe(200)
  })

  test('conservatively estimates providers that report all-zero usage', async () => {
    context = await createTestContext()
    await writeFile(
      context.transcriptPath,
      assistantLine('zero-usage', context.clock.now + 1_000, {
        input: 0,
        output: 0,
        cacheCreation: 0,
        cacheRead: 0,
      }),
    )
    const usage = await readTranscriptUsage(
      context.transcriptPath,
      new Date(context.clock.now).toISOString(),
      [],
    )
    expect(usage.usageAvailable).toBe(false)
    expect(usage.estimatedTokens).toBeGreaterThan(0)
  })
})
