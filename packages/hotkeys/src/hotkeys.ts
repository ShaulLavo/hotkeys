import { requireShortcut } from './shortcut.js'
import { Store } from '@tanstack/store'
import { createBrowserDispatcher } from './adapters/browser-dispatcher.js'
import { keyInputFromKeyboardEvent } from './adapters/browser.js'
import { isRecordingEvent } from './_recording-guard.js'
import { shouldIgnoreInputEvent } from './_event-target.js'
import { getDefaultIgnoreInputs, handleConflict, optionsEqual } from './_registration.js'
import { matchesKeyInput } from './match.js'
import { isModifierKey, normalizeHotkey, parseHotkey } from './parse.js'
import { detectPlatform } from './platform.js'
import type { BrowserDispatcher } from './adapters/browser-dispatcher.js'
import type { FocusNode } from './dispatch/dispatcher.js'
import type { KeyInput } from './key-input.js'
import type { KeymapEntry } from './dispatch/keymap.js'
import type {
  ConflictBehavior,
  HotkeyInput,
  Shortcut,
  HotkeyCallback,
  HotkeyMeta,
  ParsedHotkey,
  RawHotkey,
} from './hotkey.types.js'

export type { ConflictBehavior }
export type HotkeyTarget = HTMLElement | Document | Window
export type Target = HotkeyTarget
/** One stroke, or several pressed in turn (`['Mod+K', 'Mod+C']`). */
export type HotkeyKeys = HotkeyInput

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
  readonly options: Readonly<Omit<HotkeyOptions, 'meta'> & { meta?: Readonly<HotkeyMeta> }>
  readonly target: Target
  readonly triggerCount: number
}
export interface HotkeyRegistration {
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
  dispose: () => void
  [Symbol.dispose]: () => void
}
export type HotkeyRegistrationHandle = HotkeyRegistration

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
  readonly [Symbol.dispose]: () => void
}

type Registration = {
  readonly id: string
  readonly order: number
  readonly keys: Shortcut
  strokes: readonly RawHotkey[]
  parsed: readonly ParsedHotkey[]
  hotkey: string
  target: Target
  callback: HotkeyCallback
  configuredOptions: HotkeyOptions
  options: HotkeyOptions
  /** Removes the command handler, which holds the callback. */
  release: () => void
  triggerCount: number
  view?: HotkeyRegistrationView
}

let nextId = 0

/**
 * Registers hotkeys on one document through a {@link BrowserDispatcher}: the newest registration
 * for a key runs first, a callback returning false passes the key on, and multi-stroke keys
 * are chords with Zed's pending rules.
 */
export type HotkeyRegistryOptions = {
  readonly document?: Document
  readonly timeoutMs?: number
  readonly capture?: boolean
}

export function createHotkeyRegistry(options: HotkeyRegistryOptions = {}): HotkeyRegistry {
  const doc = options.document ?? document
  const entries = new Map<string, Registration>()
  const keyups = new Set<Registration>()
  const firedKeys = new Set<Registration>()
  const registrations = new Store<ReadonlyMap<string, HotkeyRegistrationView>>(new Map())
  let dirty = false
  let disposed = false
  // Listening before the dispatcher does: it swallows the release of a key it claimed.
  doc.addEventListener('keyup', onKeyUp, true)
  const dispatcher = createBrowserDispatcher({
    root: doc,
    capture: options.capture,
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
      firedKeys.clear()
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
        keys: entry.strokes,
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
    const { hotkey: shortcut, parsed: strokes } = entry
    if (entry.options.eventType !== 'keyup') firedKeys.add(entry)
    entry.triggerCount += 1
    entry.view = undefined
    registrations.setState((previous) => new Map(previous).set(entry.id, view(entry)))
    return entry.callback(event, { shortcut, strokes, stroke: strokes.at(-1)! })
  }
  function accepts(entry: Registration, event: KeyboardEvent): boolean {
    if (isRecordingEvent(event)) return false
    if (!isInsideTarget(event, entry.target)) return false
    if (entry.options.ignoreInputs && shouldIgnoreInputEvent(event, doc, entry.target)) return false
    return true
  }
  function run(entry: Registration, event: KeyboardEvent): boolean {
    if (!accepts(entry, event)) return false
    if (entry.options.requireReset && firedKeys.has(entry)) return true
    return fire(entry, event) !== false
  }
  function onKeyUp(event: KeyboardEvent) {
    resetReleased(event)
    if (!keyups.size) return
    const releases = Array.from(keyups).sort((a, b) => b.order - a.order)
    for (const entry of releases) {
      if (entries.get(entry.id) !== entry || entry.options.eventType !== 'keyup') continue
      if (runKeyUp(entry, event)) break
    }
  }
  function resetReleased(event: KeyboardEvent) {
    if (!firedKeys.size) return
    const input = keyInputFromKeyboardEvent(event)
    if (isModifierKey(input.key)) {
      firedKeys.clear()
      return
    }
    for (const entry of firedKeys) {
      if (releases(entry.parsed.at(-1)!, input)) firedKeys.delete(entry)
    }
  }
  function runKeyUp(entry: Registration, event: KeyboardEvent): boolean {
    if (entry.options.enabled === false || entry.strokes.length !== 1) return false
    const input = {
      ...keyInputFromKeyboardEvent(event, entry.options.platform),
      type: 'keydown' as const,
    }
    if (!matchesKeyInput(input, entry.parsed[0]!, entry.options.platform) || !accepts(entry, event))
      return false
    if (fire(entry, event) === false) return false
    if (entry.options.preventDefault !== false) event.preventDefault()
    if (entry.options.stopPropagation !== false) event.stopPropagation()
    return true
  }
  function register(
    keys: HotkeyKeys,
    callback: HotkeyCallback,
    registrationOptions: HotkeyOptions = {},
  ): HotkeyRegistrationHandle {
    if (disposed) throw new Error('Hotkey registry is disposed')
    const order = ++nextId
    const id = `hotkey_${order}`
    const configuredOptions = Object.assign({}, registrationOptions)
    const platform = configuredOptions.platform ?? detectPlatform()
    const list = requireShortcut(keys)
    const binding = resolveBinding(list, platform)
    const target = resolveTarget(configuredOptions.target)
    const resolvedOptions = resolveOptions(configuredOptions, binding.parsed, platform)
    const existing =
      configuredOptions.conflictBehavior === 'allow'
        ? undefined
        : findConflict(binding.parsed, target, resolvedOptions.eventType)
    if (existing)
      handleConflict(
        existing.id,
        binding.hotkey,
        configuredOptions.conflictBehavior ?? 'warn',
        removeEntry,
      )
    const entry: Registration = {
      id,
      order,
      keys: list,
      strokes: binding.strokes,
      parsed: binding.parsed,
      hotkey: binding.hotkey,
      target,
      callback,
      configuredOptions,
      options: resolvedOptions,
      release: () => {},
      triggerCount: 0,
    }
    try {
      entries.set(id, entry)
      if (resolvedOptions.eventType === 'keyup') keyups.add(entry)
      entry.release = root.handle(id, ({ source }) => (source ? run(entry, source) : false))
      publish()
    } catch (error) {
      removeEntry(id)
      try {
        publish()
      } catch {
        // Preserve the acquisition error if a cleanup observer also throws.
      }
      throw error
    }
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
      dispose: () => remove(id),
      [Symbol.dispose]: () => remove(id),
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
    for (const entry of entries.values()) {
      if (entry === except || entry.target !== target) continue
      if ((entry.options.eventType ?? 'keydown') !== (eventType ?? 'keydown')) continue
      if (sameStrokes(entry.parsed, parsed)) return entry
    }
    return undefined
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
    if (identityChanged && resolved.conflictBehavior !== 'allow') {
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
    entry.view = undefined
    entry.options = resolved
    entry.target = target
    entry.parsed = binding.parsed
    entry.strokes = binding.strokes
    entry.hotkey = binding.hotkey
    if (eventTypeChanged) {
      if (resolved.eventType === 'keyup') keyups.add(entry)
      if (resolved.eventType !== 'keyup') keyups.delete(entry)
    }
    if (targetChanged || platformChanged || eventTypeChanged) firedKeys.delete(entry)
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
    keyups.delete(entry)
    firedKeys.delete(entry)
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
  function dispose() {
    if (disposed) return
    disposed = true
    if (registries.get(doc) === registry) registries.delete(doc)
    doc.removeEventListener('keyup', onKeyUp, true)
    try {
      dispatcher.dispose()
    } finally {
      for (const entry of entries.values()) entry.release()
      entries.clear()
      keyups.clear()
      firedKeys.clear()
      registrations.setState(() => new Map())
    }
  }
  const registry: HotkeyRegistry = {
    register,
    registrations,
    trigger,
    dispatcher,
    dispose,
    [Symbol.dispose]: dispose,
  }
  return registry
}

function view(entry: Registration): HotkeyRegistrationView {
  return (entry.view ??= Object.freeze({
    id: entry.id,
    hotkey: entry.hotkey,
    strokes: entry.parsed,
    options: entry.options,
    target: entry.target,
    triggerCount: entry.triggerCount,
  }))
}

function resolveBinding(keys: Shortcut, platform: NonNullable<HotkeyOptions['platform']>) {
  const parsed = Object.freeze(
    keys.map((stroke) => {
      const value = parseHotkey(stroke, platform)
      Object.freeze(value.modifiers)
      return Object.freeze(value)
    }),
  )
  return {
    parsed,
    strokes: parsed.map(explicitStroke),
    hotkey: keys.map((stroke) => normalizeHotkey(stroke, { platform })).join(' '),
  }
}

function resolveOptions(
  configured: HotkeyOptions,
  parsed: readonly ParsedHotkey[],
  platform: NonNullable<HotkeyOptions['platform']>,
): HotkeyOptions {
  return Object.freeze({
    ...configured,
    platform,
    ignoreInputs: configured.ignoreInputs ?? getDefaultIgnoreInputs(parsed[0]!),
    ...(configured.meta && { meta: Object.freeze({ ...configured.meta }) }),
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

export function registerHotkey(
  keys: HotkeyInput,
  callback: HotkeyCallback,
  options?: HotkeyOptions,
): HotkeyRegistration {
  const target = options?.target
  const doc = target ? targetDocument(target) : undefined
  return getHotkeyRegistry(doc ?? undefined).register(keys, callback, options)
}

function targetDocument(target: HotkeyTarget): Document {
  if ('document' in target) return target.document
  if ('defaultView' in target) return target
  return target.ownerDocument
}
