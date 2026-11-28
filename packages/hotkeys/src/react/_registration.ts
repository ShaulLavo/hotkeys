import type { HotkeyTarget } from '@shaulavo/hotkeys'
import type { RefObject } from 'react'

export function resolveTarget(
  target: HotkeyTarget | RefObject<HTMLElement | null> | null | undefined,
): HotkeyTarget | null | undefined {
  if (target && 'current' in target) return target.current
  return target ?? undefined
}
