import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire, SourceMap, stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const release = JSON.parse(await readFile(join(root, 'release/manifest.json'), 'utf8'))
const [artifact] = release.artifacts
const tarball = join(root, 'release', artifact.file)
const require = createRequire(new URL('../package.json', import.meta.url))
const compiler = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const sourceManifest = JSON.parse(
  await readFile(join(root, 'packages/hotkeys/package.json'), 'utf8'),
)

const sourceMapSamples = [
  ['.', 'src/parse.ts', 'parseHotkey'],
  ['./react', 'src/react/useHotkey.ts', 'useHotkey'],
  ['./react', 'src/react/HotkeysProvider.tsx', 'HotkeysProvider'],
]

function assertRelativePath(path, label) {
  assert(
    typeof path === 'string' &&
      path.length > 0 &&
      !isAbsolute(path) &&
      !/^[a-z][a-z\d+.-]*:|\\/i.test(path),
    `${label}: expected a portable relative path`,
  )
}

async function checkSourceMap(directory, manifest, exportKey, sourceFile, functionName) {
  const entrypoint = join(directory, manifest.exports[exportKey].import)
  const javascript = await readFile(entrypoint, 'utf8')
  const reference = javascript.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1]
  assert(reference, `${manifest.name} (${exportKey}): missing linked JavaScript source map`)
  assertRelativePath(reference, `${manifest.name} (${exportKey}) sourceMappingURL`)
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

  // With --splitting, code may live in a shared chunk imported by the entrypoint.
  let targetJs = javascript
  let targetMap = map
  let offset = targetJs.indexOf(`function ${functionName}(`)
  if (offset < 0) {
    const chunkMatch = javascript.match(/from\s*["'](\.\.?\/[^"']+\.js)["']/)
    if (chunkMatch) {
      const chunkPath = join(dirname(entrypoint), chunkMatch[1])
      targetJs = await readFile(chunkPath, 'utf8')
      const chunkRef = targetJs.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1]
      assert(chunkRef, `${manifest.name}: missing chunk source map`)
      targetMap = JSON.parse(await readFile(join(dirname(chunkPath), chunkRef), 'utf8'))
      offset = targetJs.indexOf(`function ${functionName}(`)
    }
  }

  const sourceIndex = targetMap.sources.findIndex(
    (name) => name === sourceFile || name.endsWith(`/${sourceFile}`),
  )
  assert(sourceIndex >= 0, `${manifest.name} (${exportKey}): missing source ${sourceFile}`)
  const original = await readFile(join(root, 'packages/hotkeys', sourceFile), 'utf8')
  assert.equal(targetMap.sourcesContent[sourceIndex], original)
  assert(offset >= 0, `${manifest.name} (${exportKey}): missing generated function ${functionName}`)
  const decoded = new SourceMap(targetMap)
  const prefix = targetJs.slice(0, offset + 'function '.length)
  const line = prefix.split('\n').length - 1
  const column = prefix.length - prefix.lastIndexOf('\n') - 1
  const entry = decoded.findEntry(line, column)
  assert.equal(entry.originalSource, targetMap.sources[sourceIndex])
  const originalLine = original.split('\n')[entry.originalLine]
  assert(originalLine?.includes(`function ${functionName}(`))
  assert(entry.originalColumn >= 0 && entry.originalColumn < originalLine.length)
}

const temporary = await mkdtemp(join(tmpdir(), 'hotkeys-consumer-'))

try {
  const bytes = await readFile(tarball)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256)
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@shaulavo/hotkeys': `file:${tarball}`,
        '@tanstack/react-store': sourceManifest.devDependencies['@tanstack/react-store'],
        react: sourceManifest.devDependencies.react,
        'react-dom': sourceManifest.devDependencies['react-dom'],
        '@types/react': sourceManifest.devDependencies['@types/react'],
        '@types/react-dom': sourceManifest.devDependencies['@types/react-dom'],
        'happy-dom': sourceManifest.devDependencies['happy-dom'],
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
  const pkgDir = join(temporary, 'node_modules/@shaulavo/hotkeys')
  const manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
  assert.equal(manifest.version, artifact.version)
  assert.equal(manifest.scripts, undefined)
  assert.equal(manifest.devDependencies, undefined)
  await readFile(join(pkgDir, manifest.exports['.'].types))
  await readFile(join(pkgDir, manifest.exports['./react'].types))
  for (const [exportKey, sourceFile, fn] of sourceMapSamples) {
    await checkSourceMap(pkgDir, manifest, exportKey, sourceFile, fn)
  }
  console.log('Packed JavaScript source maps resolve to embedded TypeScript originals.')
  const consumer = `
import assert from 'node:assert/strict'
import { createDispatcher, createKeyInput, matchesKeyInput, parseHotkey, getHotkeyRegistry } from '@shaulavo/hotkeys'
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
} from '@shaulavo/hotkeys/react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { HotkeyRecorder, HotkeySequenceRecorder } from '@shaulavo/hotkeys'
assert.equal(parseHotkey('Mod+S', 'linux').ctrl, true)
assert.equal(parseHotkey('Mod+S', 'mac').meta, true)
assert.equal(reactRegistry, getHotkeyRegistry)

for (const [glyph, code] of [['?', 'Slash'], ['+', 'Equal']]) {
  const input = createKeyInput({ key: glyph, code, modifiers: { shift: true } })
  assert.equal(matchesKeyInput(input, glyph, 'linux'), true)
  const calls = []
  const dispatcher = createDispatcher({
    platform: 'linux',
    keymap: [
      { keys: glyph, command: 'single' },
      { keys: ['G', glyph], command: 'chord' },
    ],
  })
  dispatcher.createNode({
    commands: {
      single: () => void calls.push('single'),
      chord: () => void calls.push('chord'),
    },
  }).focus()
  try {
    assert.equal(dispatcher.handleKey(input, null), true, 'Shift+' + code + ' must dispatch ' + glyph)
    assert.equal(dispatcher.handleKey(createKeyInput({ key: 'G' }), null), true)
    assert.equal(dispatcher.pending()?.keys, 'G')
    assert.equal(dispatcher.handleKey(input, null), true)
    assert.deepEqual(calls, ['single', 'chord'])
    assert.equal(dispatcher.pending(), null)
  } finally {
    dispatcher.dispose()
  }
}

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

for (const Recorder of [HotkeyRecorder, HotkeySequenceRecorder]) {
  let cancellations = 0
  const recorder = new Recorder({
    onRecord: () => {},
    onCancel: () => { cancellations += 1 },
  })
  try {
    recorder.setOptions({ ignoreInputs: false })
    recorder.cancel()
    assert.equal(cancellations, 1, 'Patching options must retain omitted callbacks')
    recorder.replaceOptions({ onRecord: () => {} })
    recorder.cancel()
    assert.equal(cancellations, 1, 'Replacing options must remove omitted callbacks')
  } finally {
    recorder.destroy()
  }
}
`
  await writeFile(join(temporary, 'consumer.mjs'), consumer)
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temporary, stdio: 'inherit' })
  const batchConsumer = await readFile(join(root, 'scripts/fixtures/batch-consumer.ts'), 'utf8')
  await writeFile(join(temporary, 'batch-consumer.ts'), batchConsumer)
  await writeFile(join(temporary, 'batch-consumer.mjs'), stripTypeScriptTypes(batchConsumer))
  execFileSync(process.execPath, ['batch-consumer.mjs'], { cwd: temporary, stdio: 'inherit' })
  await writeFile(
    join(temporary, 'consumer.ts'),
    `import { createDispatcher, createHotkeyRegistry, formatHotkeySequence, HotkeyRecorder, HotkeySequenceRecorder, parseHotkey } from '@shaulavo/hotkeys'
import { useHotkey, useHotkeys, useHotkeySequence, useHotkeySequences } from '@shaulavo/hotkeys/react'
import type { HotkeySequence } from '@shaulavo/hotkeys'
import type { ReactHotkeySequenceRecorder, UseHotkeyDefinition, UseHotkeySequenceDefinition } from '@shaulavo/hotkeys/react'
parseHotkey('Mod+S', 'linux')
createDispatcher({ platform: 'linux', keymap: [] })
useHotkey('Mod+S', () => {})

const registration = createHotkeyRegistry().register('Mod+S', () => {}, { platform: 'linux' })
registration.setOptions({ platform: 'mac' })
registration.replaceOptions({ target: document })
registration.unregister()
const recorder = new HotkeyRecorder({ onRecord: () => {} })
recorder.setOptions({ ignoreInputs: false })
recorder.replaceOptions({ onRecord: () => {} })
const sequenceRecorder = new HotkeySequenceRecorder({ onRecord: () => {} })
sequenceRecorder.setOptions({ idleTimeoutMs: 1000 })
sequenceRecorder.replaceOptions({ onRecord: () => {} })

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
        'batch-consumer.ts',
      ],
      { cwd: temporary, stdio: 'inherit' },
    )
  }
  console.log('Packed declarations resolve with Bundler and NodeNext outside the workspace.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
