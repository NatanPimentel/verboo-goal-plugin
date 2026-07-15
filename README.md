# Verboo Goal Plugin

Persistent, budget-aware `/goal` loops for [Verboo Code](https://github.com/verbeux-ai/code).

Set a concrete objective once. The plugin keeps the objective, progress, limits, and evidence attached to the current Verboo session, then safely asks the model to continue when it would otherwise stop.

## Install

Requires Verboo Code 0.12.0 or newer.

```bash
verboo plugin marketplace add NatanPimentel/verboo-goal-plugin
verboo plugin install goal@verboo-goal
```

Restart Verboo after installation. During local development, load the checkout directly:

```bash
verboo --plugin-dir /path/to/verboo-goal-plugin
```

If you open Verboo directly inside the repository without `--plugin-dir`, you may see a diagnostic warning that `${CLAUDE_PLUGIN_ROOT}` is missing. That variable is only defined when the plugin is loaded as a plugin. To work on the MCP server without installing it, use the checked-in development config:

```bash
verboo --mcp-config .mcp.dev.json
```

Or use the convenience scripts:

```bash
bun run dev:plugin   # verboo --plugin-dir .
bun run dev:mcp      # verboo --mcp-config .mcp.dev.json
```

The production `.mcp.json` and `hooks/hooks.json` keep the literal `${CLAUDE_PLUGIN_ROOT}` placeholder because the plugin contract requires it.

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

An explicitly created or resumed active goal is the user's session-scoped authorization for autonomous execution. With **Auto-approve permissions during active goals** enabled, the `PreToolUse` hook returns an allow decision for ordinary tool requests before the approval UI, without changing the tool input or writing global permission rules. This applies only while the goal is active and outside Plan mode; paused, completed, cleared, or nonexistent goals use Verboo's normal flow.

Verboo's explicit permission rules retain precedence. The plugin never overrides an explicit `deny`. An explicit `ask` rule, or a tool path that requires Verboo's `canUseTool` flow, can still make the approval UI appear briefly. In those cases `PermissionRequest` is the fallback: for an eligible active goal it responds so the goal does not remain waiting for approval. With the setting disabled, outside an active goal, or in Plan mode, it emits no approval decision.

The same eligible goal-time policy handles MCP `Elicitation` before a form or URL dialog: it returns `action: "decline"`. It does not invent form fields or claim that a URL was opened, so the agent can choose an alternative. Outside an eligible active goal it does not interfere. If autonomy state is corrupt or unavailable, elicitation declines fail closed rather than leaving the goal waiting.

Plan mode is a hard boundary. Goal lifecycle and context events pause an active goal when they observe Plan mode; the latency-sensitive autonomy hooks intentionally make no decision and do not mutate state there. The plugin never changes Verboo's permission mode and never enables `bypassPermissions`.

Initial workspace trust and the initial `.mcp.json` approval occur before plugin hooks run. They are a one-time Verboo preflight that this plugin cannot skip; the autonomy hooks apply only after that preflight.

## Defaults and limits

| Setting | Default |
|---|---:|
| Auto-approve permissions and decline MCP elicitation during active goals | enabled |
| Automatic continuation | enabled |
| Wait for child agents | enabled |
| Maximum automatic turns | 25 |
| Token budget | unlimited |
| Active-time limit | unlimited |
| Low-progress threshold | 50 output tokens |
| Consecutive low-progress turns | 2 |
| Consecutive stop failures | 3 |

Change defaults from Verboo's plugin manager. Per-goal `--tokens`, `--turns`, and `--duration` flags override the corresponding defaults.

If permission auto-approval is disabled, the plugin never answers `PreToolUse` or `PermissionRequest` and never declines `Elicitation`; Verboo retains full control of permission and elicitation dialogs.

Some Verboo providers currently write zeroes into every transcript usage field. In that case the plugin uses a conservative transcript-size estimate and reports the turn as unmetered, so a token limit still fails safely instead of silently becoming unlimited.

## Persistence and safety

- State lives under `${CLAUDE_PLUGIN_DATA}` and survives plugin updates.
- Session filenames are SHA-256 hashes; the original session ID stays inside the owner-only JSON file.
- Writes use a per-session lock and atomic replace.
- The common autonomy lookup is read-only: it takes no session lock and does not rewrite session or configuration state. Updated plugin defaults are persisted on `UserPromptSubmit` and `SessionStart`, before later hooks need them.
- Corrupt state is never silently overwritten. Auto-continuation fails open and lets the user stop; a corrupt or unavailable autonomy decision fails closed with a diagnostic or decline, so it cannot wait indefinitely for an approval or elicitation dialog.
- Objectives, evidence, and blockers are capped at 4,000 characters.
- Objectives and checkpoint summaries are XML-escaped and wrapped as untrusted data in continuation prompts.
- Duplicate Stop events, stale child-agent state, low-progress turns, and repeated failures all have loop breakers.
- The runtime uses bundled Node ESM only—no Bash scripts, `jq`, Perl, Python, or install step.

The reminder, continuation prompt, and compaction handoff preserve the same autonomy policy: an active goal authorizes autonomous execution; do not ask for approval or confirmation; make reasonable, reversible assumptions from the repository and existing context. If a tool, permission, elicitation, or external operation is denied or unavailable, try an alternative instead of repeating the same request or stopping. Ask for user input only when material information cannot be inferred, or when a genuine external dependency makes progress impossible.

The plugin does not add a permanent TUI status widget because Verboo Code does not currently expose that visual extension point. `/goal status`, MCP results, and hook messages expose the current state.

## Development

```bash
bun install
bun run typecheck
bun run lint
bun run build
bun test
bun run validate:versions
bun run validate:plugin-offline
verboo plugin validate .
verboo plugin validate .claude-plugin/plugin.json
```

When running `bun run check`, the build regenerates `dist/` and all validators run against the committed contract. The `.mcp.dev.json` file is intentionally not part of the plugin contract; it exists only for local MCP development.

The official Verboo 0.12.0 validator currently requires an authenticated CLI even though validation is local. CI therefore runs the checked-in offline contract validator; run the two official commands above as an authenticated release preflight.

The generated `dist/mcp-server.mjs` and `dist/hook-runner.mjs` are committed so installed users need only the Node runtime already shipped with Verboo Code.

## Attribution

The goal lifecycle is inspired by [prevalentWare/opencode-goal-plugin](https://github.com/prevalentWare/opencode-goal-plugin), licensed under MIT. This implementation uses Verboo Code's public command, hook, MCP, and plugin-data extension surfaces and contains no Verboo core source.

## License

MIT
