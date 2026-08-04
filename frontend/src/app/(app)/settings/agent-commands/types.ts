/**
 * View types + constants for `/settings/agent-commands`.
 *
 * The backend stores ONLY overrides, so the page's row model is the union of
 * "commands we know the runner ships" and "commands this account has
 * customized". Provenance is derived from whether an override row exists.
 */

import type { AgentCommand } from "@/lib/api/agent-commands";

/** Where the body a spawned session will actually receive comes from. */
export type CommandProvenance = "default" | "customized";

/** One row of the command list. */
export interface CommandRow {
  /** The command slug, e.g. `vet-plan`. */
  name: string;
  provenance: CommandProvenance;
  /** The stored override, or `null` when this command resolves to the
   *  runner's embedded default (there is no default row to load). */
  override: AgentCommand | null;
}

/**
 * Commands the runner is known to ship embedded.
 *
 * This is a DISPLAY SEED, not a schema: qontinui-web holds no inventory of the
 * runner's embedded bundle (the bodies live in the runner binary via
 * `include_str!`), so this list only decides which un-customized commands get a
 * visible row. Nothing else keys off it — customizing a name that is not
 * listed here works exactly the same, and an override for an unknown name
 * renders from the server list. Keep it a plain list so adding an Nth command
 * is a one-line change; the count is never assumed to be two.
 */
export const KNOWN_EMBEDDED_COMMANDS: readonly string[] = [
  "implement-plan",
  "vet-plan",
];

/** Build the display rows: known-embedded names plus every stored override. */
export function buildCommandRows(overrides: AgentCommand[]): CommandRow[] {
  const byName = new Map<string, AgentCommand>();
  for (const override of overrides) {
    byName.set(override.name, override);
  }

  const names = new Set<string>([...KNOWN_EMBEDDED_COMMANDS, ...byName.keys()]);

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const override = byName.get(name) ?? null;
      return {
        name,
        provenance: override ? "customized" : "default",
        override,
      } satisfies CommandRow;
    });
}

/** A command slug is provisioned as `<name>.md` into a session cwd, so it has
 *  to be a safe single path segment. */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export function validateCommandName(name: string): string | null {
  if (!name) return "Enter a command name.";
  if (!COMMAND_NAME_PATTERN.test(name)) {
    return "Use lowercase letters, digits and hyphens (e.g. implement-plan).";
  }
  return null;
}
