import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const release = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
const [core, react] = release.artifacts
const coreFile = join(root, 'release', core.file)
const reactFile = join(root, 'release', react.file)
const require = createRequire(new URL('../package.json', import.meta.url))
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const peers = JSON.parse(await readFile(join(root, 'packages/react-hotkeys/package.json'), 'utf8'))

const temporary = await mkdtemp(join(tmpdir(), 'hotkeys-consumer-'))

try {
  for (const artifact of release.artifacts) {
    const bytes = await readFile(join(root, 'release', artifact.file))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256)
  }
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@fregat/hotkeys': `file:${coreFile}`,
        '@fregat/react-hotkeys': `file:${reactFile}`,
        react: peers.devDependencies.react,
        'react-dom': peers.devDependencies['react-dom'],
        '@types/react': peers.devDependencies['@types/react'],
      },
    }),
  )
  const bun = process.argv.includes('--bun')
  execFileSync(
    bun ? 'bun' : 'npm',
    bun
      ? ['install', '--ignore-scripts']
      : ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
    { cwd: temporary, stdio: 'inherit' },
  )
  const installed = join(temporary, 'node_modules/@fregat')
  const manifest = JSON.parse(await readFile(join(installed, 'react-hotkeys/package.json'), 'utf8'))
  assert.equal(manifest.peerDependencies['@fregat/hotkeys'], core.version)
  assert.equal(manifest.dependencies['@fregat/hotkeys'], undefined)
  for (const artifact of release.artifacts) {
    const manifest = JSON.parse(
      await readFile(join(temporary, 'node_modules', artifact.name, 'package.json'), 'utf8'),
    )
    assert.equal(manifest.version, artifact.version)
    assert.equal(manifest.scripts, undefined)
    assert.equal(manifest.devDependencies, undefined)
    await readFile(join(temporary, 'node_modules', artifact.name, manifest.types))
  }
  const consumer = `
import assert from 'node:assert/strict'
import { parseHotkey, getHotkeyRegistry } from '@fregat/hotkeys'
import { getHotkeyRegistry as reactRegistry, HotkeysProvider } from '@fregat/react-hotkeys'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
assert.equal(parseHotkey('Mod+S', 'linux').ctrl, true)
assert.equal(parseHotkey('Mod+S', 'mac').meta, true)
assert.equal(reactRegistry, getHotkeyRegistry)
assert.equal(
  renderToString(createElement(HotkeysProvider, null, createElement('button', null, 'Save'))),
  '<button>Save</button>',
)
console.log('Packed core and React adapter load in Node with one core instance.')
`
  await writeFile(join(temporary, 'consumer.mjs'), consumer)
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'inherit' })
  await writeFile(
    join(temporary, 'consumer.ts'),
    `import { createDispatcher, parseHotkey } from '@fregat/hotkeys'
import { useHotkey } from '@fregat/react-hotkeys'
parseHotkey('Mod+S', 'linux')
createDispatcher({ platform: 'linux', keymap: [] })
useHotkey('Mod+S', () => {})
`,
  )
  for (const [resolution, module] of [
    ['bundler', 'esnext'],
    ['nodenext', 'nodenext'],
  ]) {
    execFileSync(
      process.execPath,
      [
        compiler,
        '--noEmit',
        '--strict',
        '--moduleResolution',
        resolution,
        '--module',
        module,
        '--target',
        'es2023',
        'consumer.ts',
      ],
      { cwd: temporary, stdio: 'inherit' },
    )
  }
  console.log('Packed declarations resolve with Bundler and NodeNext outside the workspace.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
