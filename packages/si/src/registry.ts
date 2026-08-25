import type { Command } from 'commander';

/**
 * Commands are data, registered from one array. The CLI this forked from grew a
 * 1300-line hand-written chain of `program.command()` calls with the same
 * try/catch copy-pasted 54 times; a registry keeps that from happening again.
 */
export interface CommandDef {
  name: string;
  description: string;
  aliases?: string[];
  /** Positional arguments, in commander syntax without the brackets. */
  args?: Array<{ name: string; description: string; required?: boolean; variadic?: boolean }>;
  options?: Array<{ flags: string; description: string; defaultValue?: string | boolean }>;
  /** Nested subcommands, e.g. `si node add`. */
  subcommands?: CommandDef[];
  run?: (...args: never[]) => Promise<void> | void;
}

function argToken(a: NonNullable<CommandDef['args']>[number]): string {
  // Commander's variadic marker is a TRAILING ellipsis (`<tools...>`). A leading
  // one parses as an ordinary argument named "...tools", so the command receives
  // a single string and iterating it yields characters.
  const inner = a.variadic ? `${a.name}...` : a.name;
  return a.required === false ? `[${inner}]` : `<${inner}>`;
}

export function register(program: Command, def: CommandDef): Command {
  const cmd = program.command(def.name).description(def.description);
  for (const alias of def.aliases ?? []) cmd.alias(alias);
  for (const a of def.args ?? []) cmd.argument(argToken(a), a.description);
  for (const o of def.options ?? []) cmd.option(o.flags, o.description, o.defaultValue);
  for (const sub of def.subcommands ?? []) register(cmd, sub);
  if (def.run) cmd.action(def.run as (...args: unknown[]) => Promise<void>);
  return cmd;
}
