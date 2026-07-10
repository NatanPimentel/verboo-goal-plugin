# Contributing

1. Use Node 22+ and Bun.
2. Run `bun install`.
3. Keep source changes in `src/` and tests in `test/`.
4. Run `bun run check` and both `verboo plugin validate` commands.
5. Commit regenerated `dist/` files with source changes.

Do not weaken Plan-mode handling, fail-open behavior, or the configured loop limits. New lifecycle behavior requires unit tests and a bundled-hook smoke test on Windows and Linux.
