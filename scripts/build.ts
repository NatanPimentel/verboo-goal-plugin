import { mkdir, readFile, writeFile } from 'node:fs/promises'

await mkdir('dist', { recursive: true })

const result = await Bun.build({
  entrypoints: ['src/mcp/mcp-server.ts', 'src/hooks/hook-runner.ts'],
  outdir: 'dist',
  naming: '[name].mjs',
  target: 'node',
  format: 'esm',
  minify: false,
  sourcemap: 'none',
  packages: 'bundle',
})

if (!result.success) {
  for (const log of result.logs) process.stderr.write(`${log}\n`)
  process.exitCode = 1
} else {
  for (const output of result.outputs) {
    const source = await readFile(output.path, 'utf8')
    await writeFile(output.path, source.replace(/[ \t]+$/gm, ''), 'utf8')
    process.stdout.write(`built ${output.path}\n`)
  }
}
