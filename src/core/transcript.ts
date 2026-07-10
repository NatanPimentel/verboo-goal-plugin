import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

interface UsageFields {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

interface AssistantUsageRecord {
  id: string
  timestamp: number
  usage: UsageFields | null
  transcriptBytes: number
}

export interface TranscriptUsageDelta {
  tokens: number
  outputTokens: number
  newMessageIds: string[]
  latestAssistantId?: string
  usageAvailable: boolean
  estimatedTokens: number
  malformedLines: number
}

const toTokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0

const parseUsage = (value: unknown): UsageFields | null => {
  if (typeof value !== 'object' || value === null) return null
  const usage = value as Record<string, unknown>
  return {
    input_tokens: toTokenCount(usage.input_tokens),
    output_tokens: toTokenCount(usage.output_tokens),
    cache_creation_input_tokens: toTokenCount(
      usage.cache_creation_input_tokens,
    ),
    cache_read_input_tokens: toTokenCount(usage.cache_read_input_tokens),
  }
}

export const readTranscriptUsage = async (
  transcriptPath: string,
  createdAt: string,
  accountedMessageIds: readonly string[],
): Promise<TranscriptUsageDelta> => {
  const createdAtMs = Date.parse(createdAt)
  const records = new Map<string, AssistantUsageRecord>()
  let malformedLines = 0
  let transcriptBytes = 0

  const lines = createInterface({
    input: createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    transcriptBytes += Buffer.byteLength(line, 'utf8') + 1
    if (!line.includes('assistant')) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const message = parsed.message as Record<string, unknown> | undefined
      if (parsed.type !== 'assistant' && message?.role !== 'assistant') continue

      const timestamp = Date.parse(String(parsed.timestamp ?? ''))
      if (!Number.isFinite(timestamp) || timestamp < createdAtMs) continue

      const idValue = message?.id ?? parsed.uuid
      if (typeof idValue !== 'string' || idValue.length === 0) continue
      records.set(idValue, {
        id: idValue,
        timestamp,
        usage: parseUsage(message?.usage),
        transcriptBytes,
      })
    } catch {
      malformedLines += 1
    }
  }

  const accounted = new Set(accountedMessageIds)
  const ordered = [...records.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  )
  const latest = ordered.at(-1)
  const fresh = ordered.filter(record => !accounted.has(record.id))

  let tokens = 0
  let outputTokens = 0
  let usageAvailable = false
  let estimatedTokens = 0
  for (const record of fresh) {
    if (!record.usage) continue
    const reportedTokens =
      record.usage.input_tokens +
      record.usage.output_tokens +
      record.usage.cache_creation_input_tokens +
      record.usage.cache_read_input_tokens
    if (reportedTokens > 0) {
      usageAvailable = true
      tokens += reportedTokens
      outputTokens += record.usage.output_tokens
    } else {
      // Some Verboo providers expose the usage object but fill every field
      // with zero. Approximate the full request context from transcript bytes;
      // JSON overhead makes this deliberately conservative for safety limits.
      estimatedTokens += Math.max(1, Math.ceil(record.transcriptBytes / 4))
    }
  }

  const result: TranscriptUsageDelta = {
    tokens,
    outputTokens,
    newMessageIds: fresh.map(record => record.id),
    usageAvailable,
    estimatedTokens,
    malformedLines,
  }
  if (latest) result.latestAssistantId = latest.id
  return result
}

export const estimateOutputTokens = (text: string | undefined): number =>
  text && text.length > 0 ? Math.max(1, Math.ceil(text.length / 4)) : 0
