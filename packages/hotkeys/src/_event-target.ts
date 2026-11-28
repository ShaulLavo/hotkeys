/**
 * Checks if an element is an input-like element that should be ignored for hotkeys.
 *
 * This includes:
 * - HTMLInputElement (all input types except button, submit, reset)
 * - HTMLTextAreaElement
 * - HTMLSelectElement
 * - Elements with contentEditable enabled
 * - Elements with an attached EditContext
 *
 * Button-type inputs (button, submit, reset) are excluded so hotkeys like
 * Mod+S and Escape fire when the user has tabbed to a form button.
 */
export function isInputElement(element: EventTarget | null): boolean {
  if (!isDomElement(element)) return false
  const DOM = element.ownerDocument.defaultView ?? globalThis
  if (element instanceof DOM.HTMLInputElement) {
    const type = element.type.toLowerCase()
    return type !== 'button' && type !== 'submit' && type !== 'reset'
  }
  if (element instanceof DOM.HTMLTextAreaElement || element instanceof DOM.HTMLSelectElement)
    return true
  return (
    element instanceof DOM.HTMLElement && (element.isContentEditable || hasEditContext(element))
  )
}

export function isDomNode(value: EventTarget | null): value is Node {
  return value !== null && 'nodeType' in value
}

export function isDomElement(value: EventTarget | null): value is Element {
  return isDomNode(value) && value.nodeType === 1
}

export function hasEditContext(element: HTMLElement): boolean {
  if (!('editContext' in element)) return false
  return typeof element.editContext === 'object' && element.editContext !== null
}

/**
 * Returns the focused element for the document associated with where hotkey
 * listeners are attached (listener root). Use this instead of the global
 * `document.activeElement` so registrations scoped to an iframe (or another
 * document) read focus from the correct tree.
 */
export function getActiveElementForListenerTarget(
  target: HTMLElement | Document | Window,
): Element | null {
  if ('activeElement' in target) return target.activeElement
  if ('document' in target) return target.document.activeElement
  return target.ownerDocument.activeElement
}

/**
 * Returns whether an event should be ignored because it originated from an
 * input-like element other than the registration target.
 *
 * This checks:
 * - the currently focused element for the listener target
 * - the event's composed path (for shadow DOM)
 * - the event target as a final fallback
 */
export function shouldIgnoreInputEvent(
  event: KeyboardEvent,
  listenerTarget: HTMLElement | Document | Window,
  registrationTarget: HTMLElement | Document | Window,
): boolean {
  const focused = getActiveElementForListenerTarget(listenerTarget)
  if (focused && isInputElement(focused) && focused !== registrationTarget) {
    return true
  }

  if (
    event
      .composedPath()
      .some((element) => isInputElement(element) && element !== registrationTarget)
  ) {
    return true
  }

  return isInputElement(event.target) && event.target !== registrationTarget
}

/**
 * Checks if an event is for the given target (originated from or bubbled to it).
 *
 * For document/window targets, also accepts document.documentElement as currentTarget
 * to handle Brave and other browsers where currentTarget may be documentElement
 * instead of document when listeners are attached to document.
 */
export function isEventForTarget(
  event: KeyboardEvent,
  target: HTMLElement | Document | Window,
): boolean {
  const { currentTarget, target: origin } = event
  if (currentTarget === target) return true
  if ('document' in target)
    return currentTarget === target.document || currentTarget === target.document.documentElement
  if ('activeElement' in target) return currentTarget === target.documentElement
  return isDomNode(origin) && target.contains(origin)
}
