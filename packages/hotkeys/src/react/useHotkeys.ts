import { useEffect, useEffectEvent, useState } from 'react'
import { getHotkeyRegistry, normalizeHotkey } from '@shaulavo/hotkeys'
import { useRegistryOptions } from './_registry-context.js'
import { resolveTarget } from './_registration.js'
import type { UseHotkeyOptions } from './useHotkey.js'
import type {
  HotkeyCallback,
  HotkeyInput,
  HotkeyOptions,
  HotkeyRegistration,
  HotkeyRegistry,
  HotkeySequence,
  HotkeyStroke,
  Shortcut,
} from '@shaulavo/hotkeys'

export type UseHotkeyDefinition = (
  | { readonly hotkey: HotkeyStroke | Shortcut; readonly sequence?: never }
  | { readonly sequence: HotkeySequence; readonly hotkey?: never }
) & {
  readonly id?: string
  readonly callback: HotkeyCallback
  readonly options?: UseHotkeyOptions
}

type RegistrationRow = {
  readonly key: string
  readonly identity: string
  readonly keys: HotkeyInput
  readonly callback: HotkeyCallback
  readonly options: HotkeyOptions
}

type Owned = {
  readonly registry: HotkeyRegistry
  readonly handle: HotkeyRegistration
  readonly identity: string
}

function planRegistrations(
  definitions: readonly UseHotkeyDefinition[],
  commonOptions: UseHotkeyOptions,
  defaultOptions: UseHotkeyOptions | undefined,
): Map<string, RegistrationRow> {
  const rows = new Map<string, RegistrationRow>()
  const ids = new Set<string>()
  for (const [index, definition] of definitions.entries()) {
    const { id, callback } = definition
    if (id !== undefined && ids.has(id)) throw new Error(`Duplicate useHotkeys id: ${id}`)
    if (id !== undefined) ids.add(id)
    if (definition.sequence?.length === 0) continue
    const options = { ...defaultOptions, ...commonOptions, ...definition.options }
    const target = resolveTarget(options.target)
    if (target === null) continue
    const keys = definition.hotkey ?? definition.sequence
    const identity = (definition.sequence ? 'sequence:' : 'hotkey:') + normalizeHotkey(keys)
    const key = id === undefined ? `idx:${index}:${identity}` : `id:${id}`
    rows.set(key, { key, identity, keys, callback, options: { ...options, target } })
  }
  return rows
}

function releaseRegistrations(registrations: Map<string, Owned>): void {
  const owned = Array.from(registrations.values())
  registrations.clear()
  let failure: { error: unknown } | undefined
  for (const { handle } of owned) {
    try {
      if (handle.isActive) handle.dispose()
    } catch (error) {
      failure ??= { error }
    }
  }
  if (failure) throw failure.error
}

function reconcileRegistrations(
  registrations: Map<string, Owned>,
  rows: ReadonlyMap<string, RegistrationRow>,
  registry: HotkeyRegistry | undefined,
): void {
  for (const [key, existing] of registrations) {
    const row = rows.get(key)
    if (
      row &&
      existing.registry === registry &&
      existing.identity === row.identity &&
      existing.handle.isActive
    )
      continue
    registrations.delete(key)
    if (existing.handle.isActive) existing.handle.dispose()
  }
  if (!registry) return
  for (const row of rows.values()) {
    const existing = registrations.get(row.key)
    if (existing?.handle.isActive) {
      existing.handle.callback = row.callback
      existing.handle.replaceOptions(row.options)
      continue
    }
    const handle = registry.register(row.keys, row.callback, row.options)
    registrations.set(row.key, { registry, handle, identity: row.identity })
  }
}

export function useHotkeys(
  definitions: readonly UseHotkeyDefinition[],
  commonOptions: UseHotkeyOptions = {},
): void {
  const { defaultOptions, registry } = useRegistryOptions()
  const [registrations] = useState(() => new Map<string, Owned>())
  const reconcile = useEffectEvent(() => {
    try {
      const rows = planRegistrations(definitions, commonOptions, defaultOptions?.hotkey)
      const activeRegistry = rows.size ? (registry ?? getHotkeyRegistry()) : undefined
      reconcileRegistrations(registrations, rows, activeRegistry)
    } catch (error) {
      try {
        releaseRegistrations(registrations)
      } catch {
        // Attempt all releases and preserve the original acquisition error.
      }
      throw error
    }
  })
  useEffect(() => {
    return () => releaseRegistrations(registrations)
  }, [registrations])
  useEffect(() => {
    reconcile()
  })
}
