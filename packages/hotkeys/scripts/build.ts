import { rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
rmSync(join(root, 'dist'), { recursive: true, force: true })

const core = await Bun.build({
  entrypoints: [join(root, 'src/index.ts')],
  outdir: join(root, 'dist'),
  target: 'browser',
  format: 'esm',
  sourcemap: 'linked',
  packages: 'external',
})
if (!core.success) {
  for (const log of core.logs) console.error(log)
  process.exit(1)
}

const react = await Bun.build({
  entrypoints: [join(root, 'src/react/index.ts')],
  outdir: join(root, 'dist/react'),
  target: 'browser',
  format: 'esm',
  sourcemap: 'linked',
  packages: 'external',
  plugins: [
    {
      name: 'external-core-self-reference',
      setup(build) {
        build.onResolve({ filter: /^@shaulavo\/hotkeys$/ }, () => ({
          path: '@shaulavo/hotkeys',
          external: true,
        }))
      },
    },
  ],
})
if (!react.success) {
  for (const log of react.logs) console.error(log)
  process.exit(1)
}
