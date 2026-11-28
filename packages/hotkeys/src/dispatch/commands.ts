export type CommandMap = Record<string, unknown>
export type AnyCommands = Record<string, unknown>
export type CommandName<Commands extends CommandMap> = Extract<keyof Commands, string>

export type CommandArgs<Args> = undefined extends Args
  ? { readonly args?: Args }
  : { readonly args: Args }

export type CommandCall<Commands extends CommandMap> = {
  [Name in CommandName<Commands>]: undefined extends Commands[Name]
    ? [command: Name, args?: Commands[Name]]
    : [command: Name, args: Commands[Name]]
}[CommandName<Commands>]
