# Changelog

## 0.2.0

- Add task board with `scout`, `worker`, `judge`, and `pm` task types and `queued`/`active`/`blocked`/`done` statuses.
- Add MCP tools `add_task`, `update_task`, `get_tasks`, `assign_task`, `get_active_task`, `add_subgoal`, and `get_subgoal`.
- Add depth-1 subgoals as child `GoalRecord`s with `parentGoalId`, `parentTaskId`, and a parent goal stack.
- Add structured task receipts with evidence, facts, contradictions, changed files, commands, verification attempts, and decisions.
- Add PM loop guidance to continuation prompts so the model dispatches matching agents against the active task.
- Add agent definitions for `pm`, `scout`, `worker`, and `judge` in `agents/`.
- Add schema v1 to v2 migration with `tasks`, `nextTaskId`, `parent`, and `stack` fields.
- Add `.mcp.dev.json` and convenience scripts for local development without requiring `CLAUDE_PLUGIN_ROOT`.

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
