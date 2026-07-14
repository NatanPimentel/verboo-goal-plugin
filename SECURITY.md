# Security Policy

## Supported versions

Security fixes are applied to the latest released version.

## Reporting

Report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include credentials, private transcripts, or goal-state files in public issues.

## Data handled

The plugin stores only goal metadata and usage counters in Verboo's plugin data directory. It does not require API keys, network access, or external services. Session transcripts are read locally for accounting and are never copied into plugin state.

## Autonomous goal execution

An explicitly created or resumed active `/goal` is session-scoped authorization for autonomous execution. With `auto_approve_permissions` enabled and outside Plan mode, `PreToolUse` can allow ordinary tool requests before the normal approval UI; it leaves tool arguments unchanged and does not persist global permission rules. This may include potentially destructive operations, so enable it only for goals you intend the agent to execute autonomously.

The plugin does not override Verboo's explicit `deny` or `ask` rules. An `ask` rule or a `canUseTool` path may briefly display Verboo's UI; `PermissionRequest` is the active-goal fallback that prevents the goal from remaining blocked there. Disable `auto_approve_permissions` to retain Verboo's normal permission and elicitation behavior.

For the same eligible active goal, MCP `Elicitation` is declined before form and URL dialogs. The plugin supplies no fabricated form fields and does not claim URLs were opened. If autonomy state is corrupt or unavailable, it fails closed with a diagnostic or decline so the agent can try an alternative rather than loop on the same request.

Initial workspace trust and initial `.mcp.json` approval happen before hooks execute. That one-time Verboo preflight is not bypassed. The plugin never changes permission mode and never enables `bypassPermissions`.
