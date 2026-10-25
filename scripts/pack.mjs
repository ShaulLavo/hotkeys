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
const tag = `hotkeys-${revision}`
const base = `https://github.com/ShaulLavo/hotkeys/releases/download/${tag}`
const packages = ['hotkeys', 'react-hotkeys']
const files = Object.fromEntries(packages.map((name) => [name, `fregat-${name}-${revision}.tgz`]))
const temporary = await mkdtemp(join(tmpdir(), 'hotkeys-pack-'))

async function pack(name) {
  const source = join(root, 'packages', name)
  const stage = join(temporary, name)
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  await mkdir(stage)
  for (const file of manifest.files) {
    await cp(join(source, file), join(stage, file), { recursive: true })
  }
  if (name === 'hotkeys') {
    await cp(join(root, 'docs/assets'), join(stage, 'docs/assets'), { recursive: true })
    const concepts = join(stage, 'docs/concepts.md')
    const text = await readFile(concepts, 'utf8')
    await writeFile(concepts, text.replaceAll('../../../docs/assets/', 'assets/'))
    const api = join(stage, 'docs/api.md')
    const reference = `https://github.com/ShaulLavo/hotkeys/blob/${revision}/packages/hotkeys/src/index.ts`
    await writeFile(api, (await readFile(api, 'utf8')).replace('../src/index.ts', reference))
  }
  delete manifest.devDependencies
  delete manifest.scripts
  for (const range of Object.values(manifest.dependencies)) {
    assert(
      !/^(workspace|catalog|file|link):/.test(range),
      `${manifest.name}: unresolved dependency`,
    )
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  execFileSync('bun', ['pm', 'pack', '--ignore-scripts', '--filename', join(output, files[name])], {
    cwd: stage,
    stdio: 'inherit',
  })
  const bytes = await readFile(join(output, files[name]))
  return {
    name: manifest.name,
    version: manifest.version,
    file: files[name],
    url: `${base}/${files[name]}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

try {
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const artifacts = []
  for (const name of packages) artifacts.push(await pack(name))
  await writeFile(
    join(output, 'manifest.json'),
    JSON.stringify({ revision, tag, artifacts }, null, 2) + '\n',
  )
  await writeFile(
    join(output, 'SHA256SUMS'),
    artifacts.map(({ sha256, file }) => `${sha256}  ${file}\n`).join(''),
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
