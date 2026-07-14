# Changelog

## 0.1.0

- Add exact `/goal` command and eight scoped MCP tools.
- Add persistent per-session state, history, evidence, and blocker handling.
- Add safe Stop-hook continuation with token, turn, duration, no-progress, duplicate-event, failure, and child-agent limits.
- Preserve goals across session resume and compaction.
- Enforce Plan-mode pause behavior and portable Node-only runtime bundles.
- Treat an active, explicitly created or resumed `/goal` as session-scoped authorization for autonomous execution.
- Add `PreToolUse` auto-allow for eligible active goals without mutating tool inputs or persisting global permission rules, while preserving Verboo's explicit `deny` and `ask` precedence.
- Keep `PermissionRequest` as the eligible-goal fallback for prompts that remain visible briefly, including `canUseTool` flows; preserve normal behavior outside active goals, when disabled, and in Plan mode.
- Add `Elicitation` decline handling for eligible active goals so MCP forms and URL dialogs do not leave work waiting; corrupt or unavailable autonomy state fails closed.
- Make the normal autonomy lookup read-only and lock-free, while persisting updated defaults during `UserPromptSubmit` and `SessionStart`.
- Carry the autonomous-execution and alternative-first policy through reminders, continuation prompts, and compaction handoffs.
- Document the one-time workspace trust and `.mcp.json` preflight, and clarify that the plugin neither changes permission mode nor enables `bypassPermissions`.
- Update CI and release verification to Verboo Code 0.12.0 and build bundles before running tests.
