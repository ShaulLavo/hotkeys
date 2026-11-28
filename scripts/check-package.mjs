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
  ['./terminal', 'src/terminal/index.ts', 'createTerminalDispatcher'],
  ['./adapter', 'src/chords/trie.ts', 'trieStep'],
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
  const files = [entrypoint]
  for (const file of files) {
    const javascript = await readFile(file, 'utf8')
    const map = await readLinkedMap(file, javascript)
    const sourceIndex = map.sources.findIndex(
      (name) => name === sourceFile || name.endsWith(`/${sourceFile}`),
    )
    if (sourceIndex >= 0) {
      await checkMapping(javascript, map, sourceIndex, sourceFile, functionName)
      return
    }
    for (const match of javascript.matchAll(/from\s*["'](\.\.?\/[^"']+\.js)["']/g)) {
      const imported = join(dirname(file), match[1])
      if (!files.includes(imported)) files.push(imported)
    }
  }
  assert.fail(`${manifest.name} (${exportKey}): missing source ${sourceFile}`)
}

async function readLinkedMap(file, javascript) {
  const reference = javascript.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1]
  assert(reference, `${file}: missing linked JavaScript source map`)
  assertRelativePath(reference, `${file} sourceMappingURL`)
  const map = JSON.parse(await readFile(join(dirname(file), reference), 'utf8'))
  assert.equal(map.version, 3)
  assert.equal(typeof map.mappings, 'string')
  assert(Array.isArray(map.sources))
  assert(Array.isArray(map.sourcesContent))
  assert.equal(map.sourcesContent.length, map.sources.length)
  if (map.sourceRoot) assertRelativePath(map.sourceRoot, `${file} sourceRoot`)
  for (const [index, source] of map.sources.entries()) {
    assertRelativePath(source, `${file} source`)
    assert(map.sourcesContent[index]?.trim(), `${file}: missing embedded source for ${source}`)
  }
  return map
}

async function checkMapping(targetJs, targetMap, sourceIndex, sourceFile, functionName) {
  const offset = targetJs.search(new RegExp(`function ${functionName}[0-9]*\\(`))
  const original = await readFile(join(root, 'packages/hotkeys', sourceFile), 'utf8')
  assert.equal(targetMap.sourcesContent[sourceIndex], original)
  assert(offset >= 0, `Missing generated function ${functionName}`)
  const decoded = new SourceMap(targetMap)
  const prefix = targetJs.slice(0, offset + 'function '.length)
  const line = prefix.split('\n').length - 1
  const column = prefix.length - prefix.lastIndexOf('\n') - 1
  const entry = decoded.findEntry(line, column)
  assert.equal(entry.originalSource, targetMap.sources[sourceIndex])
  const originalLine = original.split('\n')[entry.originalLine]
  assert.match(originalLine ?? '', new RegExp(`function ${functionName}[<(]`))
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
  const consumerRequire = createRequire(join(temporary, 'package.json'))
  for (const subpath of ['.', './react', './terminal', './adapter']) {
    await readFile(join(pkgDir, manifest.exports[subpath].types))
    const name = subpath === '.' ? manifest.name : manifest.name + subpath.slice(1)
    assert.equal(consumerRequire.resolve(name), join(pkgDir, manifest.exports[subpath].import))
  }
  for (const [exportKey, sourceFile, fn] of sourceMapSamples) {
    await checkSourceMap(pkgDir, manifest, exportKey, sourceFile, fn)
  }
  console.log('Packed JavaScript source maps resolve to embedded TypeScript originals.')
  const consumer = `
import assert from 'node:assert/strict'
import { createDispatcher, createKeyInput, matchesKeyInput, parseHotkey } from '@shaulavo/hotkeys'
import {
  createHotkeysContext,
  FocusScope,
  HotkeysProvider,
  useFocusNode,
  useHotkeysDispatcher,
  usePendingChord,
  useHeldKeyCodes,
  useHeldKeys,
  useHotkey,
  useHotkeyHint,
  useHotkeyRecorder,
  useHotkeyRegistrations,
  useHotkeys,
  useHotkeySequence,
  useHotkeySequenceRecorder,
  useKeyHold,
} from '@shaulavo/hotkeys/react'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { HotkeyRecorder, HotkeySequenceRecorder } from '@shaulavo/hotkeys'
assert.equal(parseHotkey('Mod+S', 'linux').ctrl, true)
assert.equal(parseHotkey('Mod+S', 'mac').meta, true)
assert.equal(typeof createHotkeysContext().useFocusNode, 'function')

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
  useHotkeys([{ hotkey: 'Escape', callback }, { sequence: ['D', 'D'], callback }])
  useHotkeySequence(['G', 'G'], callback)
  assert.equal(useHotkeysDispatcher(), null)
  assert.equal(usePendingChord(), null)
  assert.equal(useFocusNode({ context: 'Workspace' }).node, null)
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

const app = createElement(HotkeysProvider, { keymap: [] }, createElement(FocusScope, null, createElement(ShortcutPreview)))
const firstRender = renderToString(app)
assert.equal(firstRender, '<div><button>Save</button></div>')
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
    recorder.dispose()
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
    `import { createBrowserDispatcher, createDispatcher, createHotkeyRegistry, normalizeHotkey, parseShortcut, HotkeyRecorder, HotkeySequenceRecorder, parseHotkey } from '@shaulavo/hotkeys'
import { createHotkeysContext, useHotkey, useHotkeys, useHotkeySequence } from '@shaulavo/hotkeys/react'
import type { Hotkey, HostedBrowserDispatcher, HostedFocusNode, KeymapEntry } from '@shaulavo/hotkeys'
import { createTerminalDispatcher } from '@shaulavo/hotkeys/terminal'
import { trieStep } from '@shaulavo/hotkeys/adapter'
createTerminalDispatcher()
void trieStep
import type { ReactHotkeySequenceRecorder, UseHotkeyDefinition } from '@shaulavo/hotkeys/react'
parseHotkey('Mod+S', 'linux')
createDispatcher({ platform: 'linux', keymap: [] })
useHotkey('Mod+S', () => {})

const registration = createHotkeyRegistry().register('Mod+S', () => {}, { platform: 'linux' })
registration.setOptions({ platform: 'mac' })
registration.replaceOptions({ target: document })
registration.dispose()
const recorder = new HotkeyRecorder({ onRecord: () => {} })
recorder.setOptions({ ignoreInputs: false })
recorder.replaceOptions({ onRecord: () => {} })
const sequenceRecorder = new HotkeySequenceRecorder({ onRecord: () => {} })
sequenceRecorder.setOptions({ idleTimeoutMs: 1000 })
sequenceRecorder.replaceOptions({ onRecord: () => {} })

const readonlySequence = ['Control+[KeyK]', 'Control+[KeyC]'] as const
const readonlyHotkeys = [{ hotkey: 'Escape', callback: () => {} }] as const
const readonlySequences = [{ sequence: ['G', 'G'], callback: () => {} }] as const
normalizeHotkey(readonlySequence)
useHotkeySequence(readonlySequence, () => {})
useHotkeys(readonlyHotkeys)
useHotkeys(readonlySequences)

const mutableSequence: Hotkey[] = ['G', 'G']
const mutableHotkeys: Array<UseHotkeyDefinition> = [{ hotkey: 'Escape', callback: () => {} }]
const mutableSequences: Array<UseHotkeyDefinition> = [{ sequence: mutableSequence, callback: () => {} }]
mutableSequence.push('Escape')
normalizeHotkey(mutableSequence)
useHotkeySequence(mutableSequence, () => {})
useHotkeys(mutableHotkeys)
useHotkeys(mutableSequences)


const App = createHotkeysContext<{ select: { index: number }; quit: void }>()
const dynamic = parseShortcut('Mod+K Mod+C')
if (dynamic.ok) {
  useHotkey(dynamic.value, () => {})
  useHotkeys([{ hotkey: dynamic.value, callback: () => {} }])
  const table: readonly KeymapEntry<{ select: { index: number }; quit: void }>[] = [
    { keys: dynamic.value, command: 'select', args: { index: 1 } },
  ]
  const dispatcher = createBrowserDispatcher<{ select: { index: number }; quit: void }>({ keymap: table })
  const host = dispatcher.createNode({ commands: { select: ({ args }) => args.index > 0 } })
  function installWidget(hosted: HostedBrowserDispatcher, parent: HostedFocusNode) {
    const widget = hosted.createNode({ parent, commands: {
      'terminal.copy': () => {},
      select: ({ args }) => typeof args === 'object' && args !== null
        && 'widgetIndex' in args && typeof args.widgetIndex === 'string',
    } })
    return hosted.attachElement(widget, document.createElement('div'))
  }
  const widget = installWidget(dispatcher.asHosted(), host)
  dispatcher.dispatchCommandFrom(host, 'select', { index: 1 })
  widget()
  dispatcher.dispose()
}
function UseAppNode() {
  return App.useFocusNode({ commands: { select: ({ args }) => args.index >= 0 } })
}
void UseAppNode

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
        '--lib',
        'ES2023,ESNext.Disposable,DOM,DOM.Iterable',
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
