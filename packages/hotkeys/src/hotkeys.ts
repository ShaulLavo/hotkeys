import { Store } from '@tanstack/store'
import { createBrowserDispatcher } from './adapters/browser-dispatcher.js'
import { keyInputFromKeyboardEvent } from './adapters/browser.js'
import { isRecordingEvent } from './_recording-guard.js'
import { shouldIgnoreInputEvent } from './_event-target.js'
import { getDefaultIgnoreInputs, handleConflict, optionsEqual } from './_registration.js'
import { matchesKeyInput } from './match.js'
import { isModifierKey, normalizeRegisterableHotkey, parseRegisterableHotkey } from './parse.js'
import { detectPlatform } from './platform.js'
import type { BrowserDispatcher } from './adapters/browser-dispatcher.js'
import type { FocusNode } from './dispatch/dispatcher.js'
import type { KeyInput } from './key-input.js'
import type { KeymapEntry } from './dispatch/keymap.js'
import type {
  ConflictBehavior,
  Hotkey,
  HotkeyCallback,
  HotkeyMeta,
  ParsedHotkey,
  RawHotkey,
  RegisterableHotkey,
} from './hotkey.types.js'

export type { ConflictBehavior }
export type Target = HTMLElement | Document | Window
/** One stroke, or several pressed in turn (`['Mod+K', 'Mod+C']`). */
export type HotkeyKeys = RegisterableHotkey | readonly RegisterableHotkey[]

export interface HotkeyOptions {
  /** How registration or an option update handles conflicting strokes, target, and event type. Defaults to 'warn'. */
  conflictBehavior?: ConflictBehavior
  /** False keeps the registration listed while it does not fire. */
  enabled?: boolean
  eventType?: 'keydown' | 'keyup'
  /** Skip the hotkey while typing. Defaults to true for bare keys and Shift/Alt chords. */
  ignoreInputs?: boolean
  /** Resolves `Mod` for this registration. */
  platform?: 'mac' | 'windows' | 'linux'
  preventDefault?: boolean
  /** Fire once per press; holding the key does not repeat it. */
  requireReset?: boolean
  stopPropagation?: boolean
  /**
   * Fire only for keys inside this element. Defaults to the registry's document.
   * Targets must belong to that document; changing scope does not move its listeners.
   */
  target?: Target | null
  meta?: HotkeyMeta
}
export interface HotkeyRegistrationView {
  readonly id: string
  /** Normalized strokes separated by spaces, such as `Mod+K Mod+C`. */
  readonly hotkey: string
  readonly strokes: readonly ParsedHotkey[]
  readonly options: HotkeyOptions
  readonly target: Target
  readonly triggerCount: number
}
export interface HotkeyRegistrationHandle {
  /** Settable, so a component can swap its callback without registering again. */
  callback: HotkeyCallback
  readonly id: string
  readonly isActive: boolean
  /**
   * Patch configured options; omission preserves a field, while undefined restores its default.
   * Behavioral changes cancel pending chords; target/platform/eventType changes also re-arm requireReset.
   * Structural conflicts and foreign targets throw before mutation. Inactive handles are unchanged.
   */
  setOptions: (options: Partial<HotkeyOptions>) => void
  /**
   * Replace configured options; omitted fields return to their defaults.
   * Uses the same rebinding and reset rules as setOptions. Inactive handles are unchanged.
   */
  replaceOptions: (options: HotkeyOptions) => void
  unregister: () => void
}
export type HotkeyRegistry = {
  readonly register: (
    keys: HotkeyKeys,
    callback: HotkeyCallback,
    options?: HotkeyOptions,
  ) => HotkeyRegistrationHandle
  /** Views for devtools and palettes; changes on register, unregister, option change and trigger. */
  readonly registrations: Store<ReadonlyMap<string, HotkeyRegistrationView>>
  /** Runs a registration's callback without a key, as devtools do. */
  readonly trigger: (id: string) => boolean
  /** The dispatcher underneath, for hosts that add focus nodes or read pending chords. */
  readonly dispatcher: BrowserDispatcher
  readonly dispose: () => void
}

type Registration = {
  readonly id: string
  readonly keys: readonly RegisterableHotkey[]
  strokes: readonly RawHotkey[]
  parsed: readonly ParsedHotkey[]
  hotkey: string
  target: Target
  callback: HotkeyCallback
  configuredOptions: HotkeyOptions
  options: HotkeyOptions
  /** Removes the command handler, which holds the callback. */
  release: () => void
  hasFired: boolean
  triggerCount: number
}

let nextId = 0

/**
 * Registers hotkeys on one document through a {@link BrowserDispatcher}: the newest registration
 * for a key runs first, a callback returning false passes the key on, and multi-stroke keys
 * are chords with Zed's pending rules.
 */
export function createHotkeyRegistry(
  options: { readonly document?: Document; readonly timeoutMs?: number } = {},
): HotkeyRegistry {
  const doc = options.document ?? document
  const entries = new Map<string, Registration>()
  const registrations = new Store<ReadonlyMap<string, HotkeyRegistrationView>>(new Map())
  let dirty = false
  // Listening before the dispatcher does: it swallows the release of a key it claimed.
  doc.addEventListener('keyup', onKeyUp, true)
  const dispatcher = createBrowserDispatcher({
    root: doc,
    // Registrations carry explicit modifiers; the dispatcher's own `Mod` is never used.
    platform: detectPlatform(),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    beforeKey: syncKeymap,
    // Filters apply before a prefix pends, so a chord no registration can take leaves the key alone.
    isAvailable: (binding, event) => {
      const entry = binding.command === null ? undefined : entries.get(binding.command)
      return entry !== undefined && accepts(entry, event)
    },
  })
  dispatcher.observeKeys({
    beforeKey: () => {},
    reset: () => {
      // Focus loss can prevent the keyup that normally re-arms requireReset shortcuts.
      for (const entry of entries.values()) entry.hasFired = false
    },
  })
  const root: FocusNode<KeyboardEvent> = dispatcher.createNode()
  dispatcher.focus(root)

  function syncKeymap() {
    if (!dirty) return
    dirty = false
    const keymap: KeymapEntry[] = []
    for (const entry of entries.values()) {
      if (entry.options.enabled === false || entry.options.eventType === 'keyup') continue
      keymap.push({
        keys: entry.strokes as unknown as readonly [RawHotkey, ...RawHotkey[]],
        command: entry.id,
        ...(entry.options.preventDefault === false && { preventDefault: false }),
        ...(entry.options.stopPropagation === false && { stopPropagation: false }),
      })
    }
    dispatcher.setKeymap(keymap)
  }
  function publish(invalidateKeymap = true) {
    if (invalidateKeymap) dirty = true
    const views = new Map<string, HotkeyRegistrationView>()
    for (const entry of entries.values()) views.set(entry.id, view(entry))
    registrations.setState(() => views)
  }
  function fire(entry: Registration, event: KeyboardEvent) {
    entry.hasFired = true
    entry.triggerCount += 1
    registrations.setState((previous) => new Map(previous).set(entry.id, view(entry)))
    const [first] = entry.parsed
    return entry.callback(event, { hotkey: entry.hotkey as Hotkey, parsedHotkey: first! })
  }
  function accepts(entry: Registration, event: KeyboardEvent): boolean {
    if (isRecordingEvent(event)) return false
    if (!isInsideTarget(event, entry.target)) return false
    if (entry.options.ignoreInputs && shouldIgnoreInputEvent(event, doc, entry.target)) return false
    return true
  }
  function run(entry: Registration, event: KeyboardEvent): boolean {
    if (!accepts(entry, event)) return false
    if (entry.options.requireReset && entry.hasFired) return true
    return fire(entry, event) !== false
  }
  function onKeyUp(event: KeyboardEvent) {
    const input = keyInputFromKeyboardEvent(event)
    for (const entry of entries.values()) {
      if (entry.options.eventType === 'keyup') {
        runKeyUp(entry, event)
        continue
      }
      // A release of the key or of any modifier re-arms a requireReset hotkey.
      if (entry.hasFired && (isModifierKey(input.key) || releases(entry.parsed.at(-1)!, input)))
        entry.hasFired = false
    }
  }
  function runKeyUp(entry: Registration, event: KeyboardEvent) {
    if (entry.options.enabled === false || entry.strokes.length !== 1) return
    const input = { ...keyInputFromKeyboardEvent(event), type: 'keydown' as const }
    if (!matchesKeyInput(input, entry.parsed[0]!, entry.options.platform)) return
    if (!accepts(entry, event)) return
    if (entry.options.preventDefault !== false) event.preventDefault()
    if (entry.options.stopPropagation !== false) event.stopPropagation()
    fire(entry, event)
  }
  function register(
    keys: HotkeyKeys,
    callback: HotkeyCallback,
    registrationOptions: HotkeyOptions = {},
  ): HotkeyRegistrationHandle {
    const id = `hotkey_${++nextId}`
    const configuredOptions = Object.assign({}, registrationOptions)
    const platform = configuredOptions.platform ?? detectPlatform()
    const list = snapshotKeys(keys)
    const binding = resolveBinding(list, platform)
    const target = resolveTarget(configuredOptions.target)
    const resolvedOptions = resolveOptions(configuredOptions, binding.parsed, platform)
    const existing = findConflict(binding.parsed, target, resolvedOptions.eventType)
    if (existing)
      handleConflict(
        existing.id,
        binding.hotkey,
        configuredOptions.conflictBehavior ?? 'warn',
        removeEntry,
      )
    const entry: Registration = {
      id,
      keys: list,
      strokes: binding.strokes,
      parsed: binding.parsed,
      hotkey: binding.hotkey,
      target,
      callback,
      configuredOptions,
      options: resolvedOptions,
      release: () => {},
      hasFired: false,
      triggerCount: 0,
    }
    entries.set(id, entry)
    entry.release = root.handle(id, ({ source }) => (source ? run(entry, source) : false))
    publish()
    return {
      id,
      get callback() {
        return entry.callback
      },
      set callback(next: HotkeyCallback) {
        entry.callback = next
      },
      get isActive() {
        return entries.get(id) === entry
      },
      setOptions: (next) => updateOptions(entry, next, false),
      replaceOptions: (next) => updateOptions(entry, next, true),
      unregister: () => remove(id),
    }
  }
  function resolveTarget(target: Target | null | undefined): Target {
    const resolved = target ?? doc
    if (
      resolved !== doc &&
      resolved !== doc.defaultView &&
      !('ownerDocument' in resolved && resolved.ownerDocument === doc)
    ) {
      throw new Error('Hotkey target must belong to the registry document.')
    }
    return resolved
  }
  function findConflict(
    parsed: readonly ParsedHotkey[],
    target: Target,
    eventType: HotkeyOptions['eventType'],
    except?: Registration,
  ): Registration | undefined {
    return Array.from(entries.values()).find(
      (entry) =>
        entry !== except &&
        entry.target === target &&
        (entry.options.eventType ?? 'keydown') === (eventType ?? 'keydown') &&
        sameStrokes(entry.parsed, parsed),
    )
  }
  function updateOptions(entry: Registration, next: HotkeyOptions, replace: boolean) {
    if (entries.get(entry.id) !== entry) return
    const configured = replace
      ? Object.assign({}, next)
      : Object.assign({}, entry.configuredOptions, next)
    const platform = configured.platform ?? detectPlatform()
    const platformChanged = platform !== entry.options.platform
    const binding = platformChanged ? resolveBinding(entry.keys, platform) : entry
    const target = resolveTarget(configured.target)
    const resolved = resolveOptions(configured, binding.parsed, platform)
    const targetChanged = target !== entry.target
    const eventTypeChanged =
      (resolved.eventType ?? 'keydown') !== (entry.options.eventType ?? 'keydown')
    const identityChanged =
      targetChanged ||
      eventTypeChanged ||
      (platformChanged && !sameStrokes(entry.parsed, binding.parsed))
    if (identityChanged) {
      const existing = findConflict(binding.parsed, target, resolved.eventType, entry)
      if (existing)
        handleConflict(
          existing.id,
          binding.hotkey,
          resolved.conflictBehavior ?? 'warn',
          removeEntry,
        )
    }
    const changesKeymap = targetChanged || platformChanged || !sameBehavior(entry.options, resolved)
    const changesView =
      changesKeymap ||
      (entry.options.conflictBehavior ?? 'warn') !== (resolved.conflictBehavior ?? 'warn') ||
      !optionsEqual({ meta: entry.options.meta }, { meta: resolved.meta })
    // Keep caller intent even when its current defaults resolve to the same behavior.
    entry.configuredOptions = configured
    if (!changesView) return
    entry.options = resolved
    entry.target = target
    entry.parsed = binding.parsed
    entry.strokes = binding.strokes
    entry.hotkey = binding.hotkey
    if (targetChanged || platformChanged || eventTypeChanged) entry.hasFired = false
    if (changesKeymap) {
      // A timer must not execute a prefix under the previous options before the next key syncs.
      dirty = true
      dispatcher.cancel('superseded')
    }
    publish(changesKeymap)
  }
  function removeEntry(id: string): boolean {
    const entry = entries.get(id)
    if (!entry) return false
    entries.delete(id)
    entry.release()
    return true
  }
  function remove(id: string) {
    if (removeEntry(id)) publish()
  }
  function trigger(id: string): boolean {
    const entry = entries.get(id)
    if (!entry) return false
    const last = entry.parsed.at(-1)!
    // A synthesized event carries the code, never a guessed character.
    fire(
      entry,
      new KeyboardEvent('keydown', {
        key: last.key ?? '',
        code: last.code ?? '',
        ctrlKey: last.ctrl,
        shiftKey: last.shift,
        altKey: last.alt,
        metaKey: last.meta,
      }),
    )
    return true
  }
  const registry: HotkeyRegistry = {
    register,
    registrations,
    trigger,
    dispatcher,
    dispose: () => {
      if (registries.get(doc) === registry) registries.delete(doc)
      doc.removeEventListener('keyup', onKeyUp, true)
      dispatcher.dispose()
      for (const entry of entries.values()) entry.release()
      entries.clear()
      registrations.setState(() => new Map())
    },
  }
  return registry
}

function view(entry: Registration): HotkeyRegistrationView {
  return {
    id: entry.id,
    hotkey: entry.hotkey,
    strokes: entry.parsed,
    options: entry.options,
    target: entry.target,
    triggerCount: entry.triggerCount,
  }
}

function snapshotKeys(keys: HotkeyKeys): readonly RegisterableHotkey[] {
  const list = (Array.isArray(keys) ? keys : [keys]) as readonly RegisterableHotkey[]
  return list.map((stroke) => (typeof stroke === 'string' ? stroke : Object.assign({}, stroke)))
}

function resolveBinding(
  keys: readonly RegisterableHotkey[],
  platform: NonNullable<HotkeyOptions['platform']>,
) {
  const parsed = keys.map((stroke) => parseRegisterableHotkey(stroke, platform))
  return {
    parsed,
    strokes: parsed.map(explicitStroke),
    hotkey: keys.map((stroke) => normalizeRegisterableHotkey(stroke, platform)).join(' '),
  }
}

function resolveOptions(
  configured: HotkeyOptions,
  parsed: readonly ParsedHotkey[],
  platform: NonNullable<HotkeyOptions['platform']>,
): HotkeyOptions {
  return Object.assign({}, configured, {
    platform,
    ignoreInputs: configured.ignoreInputs ?? getDefaultIgnoreInputs(parsed[0]!),
  })
}

function sameStrokes(left: readonly ParsedHotkey[], right: readonly ParsedHotkey[]): boolean {
  return (
    left.length === right.length &&
    left.every((stroke, index) => {
      const other = right[index]!
      return (
        stroke.key === other.key &&
        stroke.code === other.code &&
        stroke.ctrl === other.ctrl &&
        stroke.alt === other.alt &&
        stroke.meta === other.meta &&
        stroke.shift === other.shift
      )
    })
  )
}

function sameBehavior(left: HotkeyOptions, right: HotkeyOptions): boolean {
  return (
    (left.enabled ?? true) === (right.enabled ?? true) &&
    (left.eventType ?? 'keydown') === (right.eventType ?? 'keydown') &&
    left.ignoreInputs === right.ignoreInputs &&
    (left.preventDefault ?? true) === (right.preventDefault ?? true) &&
    (left.stopPropagation ?? true) === (right.stopPropagation ?? true) &&
    (left.requireReset ?? false) === (right.requireReset ?? false)
  )
}

// Resolves Mod now, so one dispatcher serves registrations made for different platforms.
function explicitStroke(parsed: ParsedHotkey): RawHotkey {
  const modifiers = { ctrl: parsed.ctrl, shift: parsed.shift, alt: parsed.alt, meta: parsed.meta }
  return parsed.code === undefined
    ? ({ key: parsed.key, ...modifiers } as RawHotkey)
    : ({ code: parsed.code, ...modifiers } as RawHotkey)
}

function releases(stroke: ParsedHotkey, input: KeyInput): boolean {
  return stroke.code === undefined ? stroke.key === input.key : stroke.code === input.code
}

function isInsideTarget(event: KeyboardEvent, target: Target): boolean {
  if (!('nodeType' in target) || target.nodeType === 9) return true
  return event.composedPath().includes(target)
}

const registries = new WeakMap<Document, HotkeyRegistry>()

/** The registry for a document, created on first use. */
export function getHotkeyRegistry(doc: Document = document): HotkeyRegistry {
  let registry = registries.get(doc)
  if (!registry) registries.set(doc, (registry = createHotkeyRegistry({ document: doc })))
  return registry
}
