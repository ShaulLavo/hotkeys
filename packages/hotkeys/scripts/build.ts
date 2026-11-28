import { rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const outdir = join(root, 'dist')
rmSync(outdir, { recursive: true, force: true })

const build = await Bun.build({
  entrypoints: ['index.ts', 'react/index.ts', 'terminal/index.ts', 'adapter/index.ts'].map(
    (entry) => join(root, 'src', entry),
  ),
  root: join(root, 'src'),
  outdir,
  target: 'browser',
  format: 'esm',
  jsx: { runtime: 'automatic', development: false },
  sourcemap: 'linked',
  packages: 'external',
  splitting: true,
  external: ['@shaulavo/hotkeys'],
})
if (!build.success) {
  for (const log of build.logs) console.error(log)
  process.exit(1)
}
