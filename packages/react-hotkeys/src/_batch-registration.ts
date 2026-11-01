import { useEffect, useRef } from 'react'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import { registrationIdentity, resolveTarget } from './_registration.js'
import { useIsomorphicLayoutEffect } from './utils.js'
import type { UseHotkeyOptions } from './useHotkey.js'
import type {
  HotkeyCallback,
  HotkeyOptions,
  HotkeyRegistrationHandle,
  RegisterableHotkey,
} from '@fregat/hotkeys'

type BatchDefinition = {
  keys: readonly RegisterableHotkey[]
  callback: HotkeyCallback
  options?: UseHotkeyOptions
}

type RegistrationRow = {
  registrationKey: string
  keys: readonly RegisterableHotkey[]
  callback: HotkeyCallback
  options: HotkeyOptions
}

function planRegistrations(
  definitions: readonly BatchDefinition[],
  commonOptions: UseHotkeyOptions,
  defaultOptions: UseHotkeyOptions | undefined,
): RegistrationRow[] {
  const rows: RegistrationRow[] = []
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index]!
    if (definition.keys.length === 0) continue

    const options = { ...defaultOptions, ...commonOptions, ...definition.options }
    const target = resolveTarget(options.target)
    if (!target) continue

    rows.push({
      registrationKey: `${index}:${registrationIdentity(definition.keys)}`,
      keys: definition.keys,
      callback: definition.callback,
      options: { ...options, target },
    })
  }
  return rows
}

function releaseRegistrations(registrations: Map<string, HotkeyRegistrationHandle>): void {
  const handles = Array.from(registrations.values())
  registrations.clear()
  let failure: { error: unknown } | undefined
  for (const handle of handles) {
    try {
      if (handle.isActive) handle.unregister()
    } catch (error) {
      failure ??= { error }
    }
  }
  if (failure) throw failure.error
}

function reconcileRegistrations(
  registrations: Map<string, HotkeyRegistrationHandle>,
  rows: readonly RegistrationRow[],
): void {
  const nextKeys = new Set(rows.map((row) => row.registrationKey))
  for (const [key, handle] of registrations) {
    if (nextKeys.has(key)) continue
    if (handle.isActive) handle.unregister()
    registrations.delete(key)
  }

  for (const row of rows) {
    const existing = registrations.get(row.registrationKey)
    if (existing?.isActive) {
      existing.callback = row.callback
      existing.replaceOptions(row.options)
      continue
    }

    const handle = getHotkeyRegistry().register(row.keys, row.callback, row.options)
    // Own each returned handle immediately, even if a later row fails.
    registrations.set(row.registrationKey, handle)
  }
}

export function useBatchRegistrations(
  definitions: readonly BatchDefinition[],
  commonOptions: UseHotkeyOptions,
  defaultOptions: UseHotkeyOptions | undefined,
): void {
  const registrationsRef = useRef(new Map<string, HotkeyRegistrationHandle>())
  const definitionsRef = useRef(definitions)
  const commonOptionsRef = useRef(commonOptions)
  const defaultOptionsRef = useRef(defaultOptions)

  // Only committed definitions may change the live registrations.
  useIsomorphicLayoutEffect(() => {
    definitionsRef.current = definitions
    commonOptionsRef.current = commonOptions
    defaultOptionsRef.current = defaultOptions
  })

  useEffect(() => {
    const registrations = registrationsRef.current
    return () => releaseRegistrations(registrations)
  }, [])

  useEffect(() => {
    const registrations = registrationsRef.current
    try {
      // Finish parsing identities and resolving refs before touching any live handle.
      const rows = planRegistrations(
        definitionsRef.current,
        commonOptionsRef.current,
        defaultOptionsRef.current,
      )
      reconcileRegistrations(registrations, rows)
    } catch (error) {
      // Fail closed for this hook. Earlier 'replace' removals outside the batch
      // remain applied; this cleanup is not a registry transaction.
      try {
        releaseRegistrations(registrations)
      } catch {
        // Every release was attempted; preserve the original reconciliation error.
      }
      throw error
    }
  })
}
