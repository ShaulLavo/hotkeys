import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Conversion tasks are recorded in docs/development.md, "Script language".
const legacyRunners = new Map([
  ['scripts/check-package.mjs', 'Convert the installed-consumer runner to TypeScript.'],
  ['scripts/check-samples.mjs', 'Convert the documentation-sample runner to TypeScript.'],
  ['scripts/pack.mjs', 'Convert the package-archive runner to TypeScript.'],
])
const root = fileURLToPath(new URL('../', import.meta.url))
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
).split('\0')
const unexpected = files.filter(
  (file) => /\.[cm]?js$/.test(file) && !legacyRunners.has(file) && existsSync(join(root, file)),
)
if (unexpected.length > 0) {
  throw new Error(`Handwritten code must use TypeScript:\n${unexpected.join('\n')}`)
}
console.log('Source language check passed.')
