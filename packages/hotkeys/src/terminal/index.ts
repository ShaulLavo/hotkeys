import { createDispatcher } from '@shaulavo/hotkeys'
import { keyInputFromTerminalKey, terminalKeyEffects } from '../adapters/terminal.js'
import type { AnyCommands, CommandMap, Dispatcher, DispatcherOptions } from '@shaulavo/hotkeys'
import type { TerminalKeyLike } from '../adapters/terminal.js'

export { keyInputFromTerminalKey, terminalKeyEffects }
export type { TerminalKeyLike }

export type TerminalDispatcherOptions<
  Source extends TerminalKeyLike,
  Commands extends CommandMap = AnyCommands,
> = Omit<DispatcherOptions<Source, Commands>, 'effects'>

export type TerminalDispatcher<
  Source extends TerminalKeyLike,
  Commands extends CommandMap = AnyCommands,
> = Dispatcher<Source, Commands> & { readonly handleTerminalKey: (event: Source) => boolean }

export function createTerminalDispatcher<
  Source extends TerminalKeyLike = TerminalKeyLike,
  Commands extends CommandMap = AnyCommands,
>(options: TerminalDispatcherOptions<Source, Commands> = {}): TerminalDispatcher<Source, Commands> {
  const dispatcher = createDispatcher<Source, Commands>({ ...options, effects: terminalKeyEffects })
  return {
    ...dispatcher,
    handleTerminalKey: (event) => dispatcher.handleKey(keyInputFromTerminalKey(event), event),
  }
}
