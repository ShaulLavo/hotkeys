import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'release')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
assert.match(revision, /^[a-f0-9]{40}$/)
const source = join(root, 'packages/hotkeys')
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const file = `shaulavo-hotkeys-${manifest.version}.tgz`
const temporary = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'hotkeys-pack-'))

try {
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const stage = join(temporary, 'hotkeys')
  await mkdir(stage)
  for (const entry of manifest.files) {
    await cp(join(source, entry), join(stage, entry), { recursive: true })
  }
  await cp(join(root, 'docs/assets'), join(stage, 'docs/assets'), { recursive: true })
  const concepts = join(stage, 'docs/concepts.md')
  const text = await readFile(concepts, 'utf8')
  await writeFile(concepts, text.replaceAll('../../../docs/assets/', 'assets/'))
  const api = join(stage, 'docs/api.md')
  const reference = `https://github.com/ShaulLavo/hotkeys/blob/${revision}/packages/hotkeys/src/index.ts`
  await writeFile(api, (await readFile(api, 'utf8')).replace('../src/index.ts', reference))
  const packedManifest = { ...manifest }
  delete packedManifest.devDependencies
  delete packedManifest.scripts
  for (const range of Object.values(packedManifest.dependencies ?? {})) {
    assert(
      !/^(workspace|catalog|file|link):/.test(range),
      `${packedManifest.name}: unresolved dependency`,
    )
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify(packedManifest, null, 2) + '\n')
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', output], {
    cwd: stage,
    stdio: 'inherit',
  })
  const bytes = await readFile(join(output, file))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const artifacts = [{ name: manifest.name, version: manifest.version, file, sha256 }]
  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify({ revision, artifacts }, null, 2) + '\n',
  )
  await writeFile(join(output, 'SHA256SUMS'), `${sha256}  ${file}\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
