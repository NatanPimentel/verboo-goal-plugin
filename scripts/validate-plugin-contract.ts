import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown

const pluginName = z.string().regex(/^[a-z0-9][-a-z0-9._]*$/i)
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
const option = z
  .object({
    type: z.enum(['boolean', 'number', 'string']),
    title: z.string().min(1),
    description: z.string().min(1),
    default: z.unknown(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict()

const pluginSchema = z
  .object({
    name: pluginName,
    version,
    description: z.string().min(1),
    author: z
      .object({ name: z.string().min(1), url: z.url() })
      .strict(),
    homepage: z.url(),
    repository: z.url(),
    license: z.string().min(1),
    keywords: z.array(z.string().min(1)).min(1),
    userConfig: z.record(z.string().regex(/^[A-Za-z_]\w*$/), option),
  })
  .strict()

const marketplaceSchema = z
  .object({
    name: pluginName,
    owner: z.object({ name: z.string().min(1) }).strict(),
    metadata: z.object({ description: z.string().min(1) }).strict(),
    plugins: z
      .array(
        z
          .object({
            name: pluginName,
            description: z.string().min(1),
            version,
            source: z.literal('./'),
            category: z.string().min(1),
            homepage: z.url(),
            strict: z.literal(true),
          })
          .strict(),
      )
      .length(1),
  })
  .strict()

const mcpSchema = z
  .object({
    mcpServers: z
      .object({
        goal: z
          .object({
            type: z.literal('stdio'),
            command: z.literal('node'),
            args: z.tuple([
              z.literal('${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.mjs'),
            ]),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

const commandHook = z
  .object({
    type: z.literal('command'),
    command: z.literal(
      'node "${CLAUDE_PLUGIN_ROOT}/dist/hook-runner.mjs"',
    ),
    timeout: z.number().int().positive().max(60),
  })
  .strict()
const hookGroup = z
  .object({ hooks: z.array(commandHook).length(1) })
  .strict()
const event = z.array(hookGroup).length(1)
const hooksSchema = z
  .object({
    description: z.string().min(1),
    hooks: z
      .object({
        Stop: event,
        StopFailure: event,
        UserPromptSubmit: event,
        SessionStart: event,
        SessionEnd: event,
        PreCompact: event,
        PostCompact: event,
        SubagentStart: event,
        SubagentStop: event,
      })
      .strict(),
  })
  .strict()

const pkg = z
  .object({ version })
  .passthrough()
  .parse(await readJson('package.json'))
const plugin = pluginSchema.parse(
  await readJson('.claude-plugin/plugin.json'),
)
const marketplace = marketplaceSchema.parse(
  await readJson('.claude-plugin/marketplace.json'),
)
mcpSchema.parse(await readJson('.mcp.json'))
hooksSchema.parse(await readJson('hooks/hooks.json'))

const entry = marketplace.plugins[0]
if (!entry) throw new Error('Marketplace must contain exactly one plugin.')
if (plugin.name !== entry.name || plugin.version !== entry.version) {
  throw new Error('Plugin and marketplace name/version must match.')
}
if (pkg.version !== plugin.version) {
  throw new Error('Package and plugin versions must match.')
}

for (const [key, value] of Object.entries(plugin.userConfig)) {
  if (typeof value.default !== value.type) {
    throw new Error(`${key}.default must be a ${value.type}.`)
  }
  if (value.type === 'number') {
    const numericDefault = value.default as number
    if (!Number.isFinite(numericDefault)) {
      throw new Error(`${key}.default must be finite.`)
    }
    if (value.min !== undefined && numericDefault < value.min) {
      throw new Error(`${key}.default is below min.`)
    }
    if (value.max !== undefined && numericDefault > value.max) {
      throw new Error(`${key}.default is above max.`)
    }
  } else if (value.min !== undefined || value.max !== undefined) {
    throw new Error(`${key} may only define min/max for number options.`)
  }
}

process.stdout.write(
  `offline plugin contract valid for ${plugin.name}@${plugin.version}\n`,
)
