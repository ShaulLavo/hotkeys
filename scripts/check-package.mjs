import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire, SourceMap } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const release = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
const [core, react] = release.artifacts
const coreFile = join(root, 'release', core.file)
const reactFile = join(root, 'release', react.file)
const require = createRequire(new URL('../package.json', import.meta.url))
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const peers = JSON.parse(await readFile(join(root, 'packages/react-hotkeys/package.json'), 'utf8'))

const sourceMapSamples = {
  '@fregat/hotkeys': [['src/parse.ts', 'parseHotkey']],
  '@fregat/react-hotkeys': [
    ['src/useHotkey.ts', 'useHotkey'],
    ['src/HotkeysProvider.tsx', 'HotkeysProvider'],
  ],
}

function assertRelativePath(path, label) {
  assert(
    typeof path === 'string' &&
      path.length > 0 &&
      !isAbsolute(path) &&
      !/^[a-z][a-z\d+.-]*:|\\/i.test(path),
    `${label}: expected a portable relative path`,
  )
}

async function checkSourceMap(directory, manifest) {
  const entrypoint = join(directory, manifest.exports['.'].import)
  const javascript = await readFile(entrypoint, 'utf8')
  const reference = javascript.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1]
  assert(reference, `${manifest.name}: missing linked JavaScript source map`)
  assertRelativePath(reference, `${manifest.name} sourceMappingURL`)
  const map = JSON.parse(await readFile(join(dirname(entrypoint), reference), 'utf8'))
  assert.equal(map.version, 3)
  assert(typeof map.mappings === 'string' && map.mappings.length > 0)
  assert(Array.isArray(map.sources) && map.sources.length > 0)
  assert(Array.isArray(map.sourcesContent))
  assert.equal(map.sourcesContent.length, map.sources.length)
  if (map.sourceRoot) assertRelativePath(map.sourceRoot, `${manifest.name} sourceRoot`)
  for (const [index, source] of map.sources.entries()) {
    assertRelativePath(source, `${manifest.name} source`)
    assert(
      typeof map.sourcesContent[index] === 'string' && map.sourcesContent[index].trim().length > 0,
      `${manifest.name}: missing embedded source for ${source}`,
    )
  }

  const decoded = new SourceMap(map)
  for (const [source, functionName] of sourceMapSamples[manifest.name]) {
    const sourceIndex = map.sources.findIndex(
      (name) => name === source || name.endsWith(`/${source}`),
    )
    assert(sourceIndex >= 0, `${manifest.name}: missing source ${source}`)
    const original = await readFile(
      join(root, 'packages', manifest.name.slice('@fregat/'.length), source),
      'utf8',
    )
    assert.equal(map.sourcesContent[sourceIndex], original)

    const offset = javascript.indexOf(`function ${functionName}(`)
    assert(offset >= 0, `${manifest.name}: missing generated function ${functionName}`)
    const prefix = javascript.slice(0, offset + 'function '.length)
    const line = prefix.split('\n').length - 1
    const column = prefix.length - prefix.lastIndexOf('\n') - 1
    const entry = decoded.findEntry(line, column)
    assert.equal(entry.originalSource, map.sources[sourceIndex])
    const originalLine = original.split('\n')[entry.originalLine]
    assert(originalLine?.includes(`function ${functionName}(`))
    assert(entry.originalColumn >= 0 && entry.originalColumn < originalLine.length)
  }
}

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
    await checkSourceMap(join(temporary, 'node_modules', artifact.name), manifest)
  }
  console.log('Packed JavaScript source maps resolve to embedded TypeScript originals.')
  const consumer = `
import assert from 'node:assert/strict'
import { createDispatcher, createKeyInput, parseHotkey, getHotkeyRegistry } from '@fregat/hotkeys'
import {
  getHotkeyRegistry as reactRegistry,
  HotkeysProvider,
  useHeldKeyCodes,
  useHeldKeys,
  useHotkey,
  useHotkeyHint,
  useHotkeyRecorder,
  useHotkeyRegistrations,
  useHotkeys,
  useHotkeySequence,
  useHotkeySequenceRecorder,
  useHotkeySequences,
  useKeyHold,
} from '@fregat/react-hotkeys'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
assert.equal(parseHotkey('Mod+S', 'linux').ctrl, true)
assert.equal(parseHotkey('Mod+S', 'mac').meta, true)
assert.equal(reactRegistry, getHotkeyRegistry)

const chordLog = []
const chordDispatcher = createDispatcher({
  platform: 'linux',
  keymap: [
    { keys: 'K C', command: 'keep', source: 'default' },
    { keys: 'K C', command: 'remove', source: 'default' },
    { keys: 'K C', unbind: 'remove', source: 'user' },
    { keys: 'G H', command: 'decline' },
    { keys: 'G H I', command: 'longer' },
  ],
  replay: input => chordLog.push(input.key),
})
chordDispatcher.createNode({
  commands: {
    keep: () => void chordLog.push('keep'),
    remove: () => assert.fail('Unbound command ran'),
    decline: () => false,
    longer: () => assert.fail('Incomplete chord ran'),
  },
}).focus()
const press = key => chordDispatcher.handleKey(createKeyInput({ key }), null)
try {
  assert.equal(press('K'), true)
  assert.equal(chordDispatcher.pending()?.candidateCount, 1)
  assert.equal(press('C'), true)
  assert.deepEqual(chordLog, ['keep'])
  assert.equal(press('G'), true)
  assert.equal(press('H'), true)
  assert.equal(press('X'), false)
  assert.equal(chordDispatcher.pending(), null)
  assert.deepEqual(chordLog, ['keep', 'G', 'H'])
} finally {
  chordDispatcher.dispose()
}

const nestedCalls = []
const nestedReplay = []
const nestedSequences = []
const nestedDispatcher = createDispatcher({
  platform: 'linux',
  keymap: [
    { keys: 'G H', command: 'outer' },
    { keys: 'X Y', command: 'inner' },
  ],
  replay: input => nestedReplay.push(input.key),
  onSequence: event => nestedSequences.push({
    keys: event.keys,
    outcome: event.outcome,
    command: event.binding?.payload.command,
  }),
})
const nestedPress = key => nestedDispatcher.handleKey(createKeyInput({ key }), null)
nestedDispatcher.createNode({
  commands: {
    outer: () => {
      nestedCalls.push('outer')
      assert.equal(nestedPress('X'), true)
    },
    inner: () => void nestedCalls.push('inner'),
  },
}).focus()
try {
  assert.equal(nestedPress('G'), true)
  assert.equal(nestedPress('H'), true)
  assert.deepEqual(nestedCalls, ['outer'])
  assert.deepEqual(nestedReplay, [], 'A successful outer chord must not replay its prefix')
  assert.deepEqual(nestedDispatcher.pending(), { keys: 'X', candidateCount: 1 })
  assert.equal(nestedPress('Y'), true)
  assert.deepEqual(nestedCalls, ['outer', 'inner'])
  assert.deepEqual(nestedReplay, [])
  assert.equal(nestedDispatcher.pending(), null)
  assert.deepEqual(nestedSequences, [
    { keys: 'G', outcome: 'completed', command: 'outer' },
    { keys: 'X', outcome: 'completed', command: 'inner' },
  ])
} finally {
  nestedDispatcher.dispose()
}

assert.equal(typeof window, 'undefined')
assert.equal(typeof document, 'undefined')

let callbackCount = 0
const callback = () => {
  callbackCount += 1
}
function ShortcutPreview() {
  useHotkey('Mod+S', callback)
  useHotkeys([{ hotkey: 'Escape', callback }])
  useHotkeySequence(['G', 'G'], callback)
  useHotkeySequences([{ sequence: ['D', 'D'], callback }])
  const registrations = useHotkeyRegistrations()
  const heldKeys = useHeldKeys()
  const heldCodes = useHeldKeyCodes()
  const shiftHeld = useKeyHold('Shift')
  const hintVisible = useHotkeyHint('Mod+S', { platform: 'linux' })
  const recorder = useHotkeyRecorder({ onRecord: callback })
  const sequenceRecorder = useHotkeySequenceRecorder({ onRecord: callback })

  assert.deepEqual(registrations, { hotkeys: [], sequences: [] })
  assert.deepEqual(heldKeys, [])
  assert.deepEqual(heldCodes, {})
  assert.equal(shiftHeld, false)
  assert.equal(hintVisible, false)
  assert.equal(recorder.isRecording, false)
  assert.equal(recorder.recordedHotkey, null)
  assert.equal(sequenceRecorder.isRecording, false)
  assert.deepEqual(sequenceRecorder.steps, [])
  assert.equal(sequenceRecorder.recordedSequence, null)
  return createElement('button', null, 'Save')
}

const app = createElement(HotkeysProvider, null, createElement(ShortcutPreview))
const firstRender = renderToString(app)
assert.equal(firstRender, '<button>Save</button>')
assert.equal(renderToString(app), firstRender)
assert.equal(callbackCount, 0)
assert.equal(typeof window, 'undefined')
assert.equal(typeof document, 'undefined')
console.log('Packed React hooks server-render in Node without a DOM and share one core instance.')
`
  await writeFile(join(temporary, 'consumer.mjs'), consumer)
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'inherit' })
  await writeFile(
    join(temporary, 'consumer.ts'),
    `import { createDispatcher, formatHotkeySequence, parseHotkey } from '@fregat/hotkeys'
import { useHotkey, useHotkeys, useHotkeySequence, useHotkeySequences } from '@fregat/react-hotkeys'
import type { HotkeySequence } from '@fregat/hotkeys'
import type { ReactHotkeySequenceRecorder, UseHotkeyDefinition, UseHotkeySequenceDefinition } from '@fregat/react-hotkeys'
parseHotkey('Mod+S', 'linux')
createDispatcher({ platform: 'linux', keymap: [] })
useHotkey('Mod+S', () => {})

const readonlySequence = ['Control+[KeyK]', 'Control+[KeyC]'] as const
const readonlyHotkeys = [{ hotkey: 'Escape', callback: () => {} }] as const
const readonlySequences = [{ sequence: ['G', 'G'], callback: () => {} }] as const
formatHotkeySequence(readonlySequence)
useHotkeySequence(readonlySequence, () => {})
useHotkeys(readonlyHotkeys)
useHotkeySequences(readonlySequences)

const mutableSequence: HotkeySequence = ['G', 'G']
const mutableHotkeys: Array<UseHotkeyDefinition> = [{ hotkey: 'Escape', callback: () => {} }]
const mutableSequences: Array<UseHotkeySequenceDefinition> = [{ sequence: mutableSequence, callback: () => {} }]
mutableSequences[0]!.sequence.push('Escape')
formatHotkeySequence(mutableSequence)
useHotkeySequence(mutableSequence, () => {})
useHotkeys(mutableHotkeys)
useHotkeySequences(mutableSequences)

const recorderSteps: ReactHotkeySequenceRecorder['steps'] = []
const recordedSequence: NonNullable<ReactHotkeySequenceRecorder['recordedSequence']> = []
recorderSteps.push('Escape')
recordedSequence.push('Escape')
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
