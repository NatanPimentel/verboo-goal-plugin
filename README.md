# Verboo Goal Plugin

Persistent, budget-aware `/goal` loops for [Verboo Code](https://github.com/verbeux-ai/code).

Set a concrete objective once. The plugin keeps the objective, progress, limits, and evidence attached to the current Verboo session, then safely asks the model to continue when it would otherwise stop.

## Install

Requires Verboo Code 0.10.7 or newer.

```bash
verboo plugin marketplace add NatanPimentel/verboo-goal-plugin
verboo plugin install goal@verboo-goal
```

Restart Verboo after installation. During local development, load the checkout directly:

```bash
verboo --plugin-dir /path/to/verboo-goal-plugin
```

## Use

```text
/goal Build the feature and verify it
/goal Build the feature --turns 20 --tokens 50000 --duration 2h
/goal status
/goal history
/goal edit Build the feature, tests, and documentation
/goal pause
/goal resume
/goal complete
/goal unmet Waiting for access to the external service
/goal clear
```

Aliases:

- Status: `status`, `show`, `current`
- Complete: `complete`, `done`
- Blocked: `unmet`, `blocked`, `blocker`
- Clear: `clear`, `stop`, `off`, `reset`, `none`, `cancel`

Only an explicit `/goal` command or explicit request may create a goal. Ordinary tasks never create one automatically.

## Lifecycle

Each session can have one unfinished goal:

- `active`: eligible for automatic continuation.
- `paused`: persisted, but never auto-continued.
- `complete`: closed with concrete evidence.
- `unmet`: closed with a concrete blocker.
- `budgetLimited`: token budget reached.
- `usageLimited`: turn or active-time limit reached.

The `Stop` hook returns `decision: "block"` only while the goal is active and inside every safety boundary. A limit produces one final handoff turn and then allows the session to stop.

Plan mode is a hard boundary. Creating, resuming, or encountering an active goal in Plan mode leaves it paused; the plugin never changes permission mode or begins implementation.

## Defaults and limits

| Setting | Default |
|---|---:|
| Automatic continuation | enabled |
| Wait for child agents | enabled |
| Maximum automatic turns | 25 |
| Token budget | unlimited |
| Active-time limit | unlimited |
| Low-progress threshold | 50 output tokens |
| Consecutive low-progress turns | 2 |
| Consecutive stop failures | 3 |

Change defaults from Verboo's plugin manager. Per-goal `--tokens`, `--turns`, and `--duration` flags override the corresponding defaults.

Some Verboo providers currently write zeroes into every transcript usage field. In that case the plugin uses a conservative transcript-size estimate and reports the turn as unmetered, so a token limit still fails safely instead of silently becoming unlimited.

## Persistence and safety

- State lives under `${CLAUDE_PLUGIN_DATA}` and survives plugin updates.
- Session filenames are SHA-256 hashes; the original session ID stays inside the owner-only JSON file.
- Writes use a per-session lock and atomic replace.
- Corrupt state is never silently overwritten. Auto-continuation fails open and lets the user stop.
- Objectives, evidence, and blockers are capped at 4,000 characters.
- Objectives and checkpoint summaries are XML-escaped and wrapped as untrusted data in continuation prompts.
- Duplicate Stop events, stale child-agent state, low-progress turns, and repeated failures all have loop breakers.
- The runtime uses bundled Node ESM only—no Bash scripts, `jq`, Perl, Python, or install step.

The plugin does not add a permanent TUI status widget because Verboo Code does not currently expose that visual extension point. `/goal status`, MCP results, and hook messages expose the current state.

## Development

```bash
bun install
bun run typecheck
bun run lint
bun test
bun run build
verboo plugin validate .
verboo plugin validate .claude-plugin/plugin.json
```

The generated `dist/mcp-server.mjs` and `dist/hook-runner.mjs` are committed so installed users need only the Node runtime already shipped with Verboo Code.

## Attribution

The goal lifecycle is inspired by [prevalentWare/opencode-goal-plugin](https://github.com/prevalentWare/opencode-goal-plugin), licensed under MIT. This implementation uses Verboo Code's public command, hook, MCP, and plugin-data extension surfaces and contains no Verboo core source.

## License

MIT
