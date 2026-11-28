/**
 * Pure derivations for the agent catalog on `/admin/coord/agent-registry`
 * (plan `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type`
 * Phase 7). No JSX here (style guide R8): the labels the screen shows are
 * derived in one tested place, and the coord vocabulary (`declared_role`,
 * `contract_kind`, `hook`, …) never reaches the screen as text.
 */

import type {
  AdminAgentRegistryRow,
  AgentCatalogEntry,
} from "@/lib/api/agent-registry";
import { relativeTime } from "@/components/console";

// ── The agent-name grammar, mirrored from coord ──────────────────────────────
//
// `validate_agent_name` / `normalize_agent_name` in qontinui-coord
// `crates/coord/src/agent_registry.rs`: ASCII-lowercased first, then 1..=64
// bytes of `[a-z0-9_-]`, and not one of the registry's static route segments.
// Coord stays the authority — its 422 `invalid_agent_name` is still rendered —
// this copy only lets the field say what is wrong before a round trip.

/** Coord's `RESERVED_AGENT_NAMES`. */
export const RESERVED_AGENT_NAMES: readonly string[] = [
  "catalog",
  "effective",
  "effective-for",
  "observed",
  "prefs",
  "retire",
];

/** Coord's `normalize_agent_name` (ASCII-only lowercasing), after trimming
 *  surrounding whitespace, which the grammar would refuse anyway. */
export function normalizeAgentName(raw: string): string {
  return raw.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Why coord would refuse this (already normalized) name, or `null`. */
export function agentNameProblem(name: string): string | null {
  const bytes = new TextEncoder().encode(name).length;
  if (bytes === 0) return "Enter an agent type name.";
  if (bytes > 64) return "An agent type name is at most 64 characters.";
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return "Use only lowercase letters, digits, '-' and '_'.";
  }
  if (RESERVED_AGENT_NAMES.includes(name)) {
    return `"${name}" is reserved by the registry and cannot name an agent type.`;
  }
  return null;
}

// ── One line on the page ─────────────────────────────────────────────────────

/**
 * One agent type, joined from the two reads the page makes.
 *
 * `catalog` is `null` when the catalog could not be read (or does not list the
 * name); `row` is `null` when the type has no registry row OR the reader may
 * not read rows (a member). Neither absence is a value: the spawn switch reads
 * UNKNOWN without the catalog, never "on".
 */
export interface AgentLine {
  agent_name: string;
  catalog: AgentCatalogEntry | null;
  row: AdminAgentRegistryRow | null;
}

export function mergeLines(
  entries: readonly AgentCatalogEntry[] | null,
  rows: readonly AdminAgentRegistryRow[]
): AgentLine[] {
  const byName = new Map<string, AgentLine>();
  for (const entry of entries ?? []) {
    byName.set(entry.agent_name, {
      agent_name: entry.agent_name,
      catalog: entry,
      row: null,
    });
  }
  // Coord keys the catalog by `normalize_agent_name`, so a legacy row whose
  // name differs only in case joins the catalog's line rather than standing
  // beside it as a second, catalog-less one.
  for (const row of rows) {
    const key = normalizeAgentName(row.agent_name);
    const line = byName.get(key);
    if (line) {
      // Coord's catalog binds the row already spelled in lowercase -- the one
      // a spawn binds and the switch writes -- over a legacy case variant.
      if (!line.row || (row.agent_name === key && line.row.agent_name !== key))
        line.row = row;
    } else
      byName.set(key, {
        agent_name: key,
        catalog: null,
        row,
      });
  }
  return [...byName.values()].sort((a, b) =>
    a.agent_name.localeCompare(b.agent_name)
  );
}

/** The tenant-admin ceiling as read: `unknown` without a catalog entry. */
export type SpawnSwitchState = "on" | "off" | "unknown";

export function spawnSwitchState(line: AgentLine): SpawnSwitchState {
  const disabled = line.catalog?.admin_disabled;
  if (disabled === true) return "off";
  if (disabled === false) return "on";
  // No catalog entry, or coord could not read the row source (`null`).
  return "unknown";
}

export function spawnPathOf(line: AgentLine): string {
  return line.row?.spawn_path || line.catalog?.spawn_path || "";
}

export function purposeOf(line: AgentLine): string {
  return line.row?.purpose || line.catalog?.purpose || "";
}

/** Whether switching spawns off needs a disposition choice (plan D5):
 *  `null` when neither the row nor the catalog says. */
export function policyRequiredOf(line: AgentLine): boolean | null {
  if (line.row) return Boolean(line.row.policy_required);
  const fromCatalog = line.catalog?.policy_required;
  return typeof fromCatalog === "boolean" ? fromCatalog : null;
}

export function needsDisposition(line: AgentLine): boolean {
  return policyRequiredOf(line) === true;
}

/** The dispositions an admin may pick for this type: the row's own set, else
 *  the set coord's catalog says a created row would get. */
export function allowedDispositionsOf(line: AgentLine): string[] {
  return (
    line.row?.allowed_dispositions ?? line.catalog?.allowed_dispositions ?? []
  );
}

/** The ceiling's disposition and reason as served. The catalog is read
 *  first: it is the read the switch's On/Off comes from, so the detail beside
 *  it never comes from an older rows read. The row fills in only when the
 *  catalog does not carry the field. `undefined` when neither does. */
export function adminDispositionOf(line: AgentLine): string | null | undefined {
  if (line.catalog && line.catalog.admin_disposition !== undefined)
    return line.catalog.admin_disposition;
  return line.row?.admin_disposition;
}

export function adminReasonOf(line: AgentLine): string | null {
  return line.catalog?.admin_reason || line.row?.admin_reason || null;
}

/** Other agent types a disable of this one also vetoes (empty when coord does
 *  not say). */
export function alsoVetoesOf(line: AgentLine): string[] {
  const v = line.catalog?.also_vetoes;
  return Array.isArray(v) ? v.filter((n) => typeof n === "string") : [];
}

// ── Source badges ────────────────────────────────────────────────────────────

export interface SourceBadge {
  key: string;
  label: string;
  title: string;
}

/**
 * Where coord learned of this type, as the screen says it.
 *
 * "no registry row — default: on" is first and distinct from every explicit
 * choice (ux-priorities `what-is-required-must-be-distinguishable-from-what-has-a-default`).
 */
export function sourceBadges(
  line: AgentLine,
  now: number = Date.now()
): SourceBadge[] {
  const badges: SourceBadge[] = [];
  const entry = line.catalog;
  if (entry && entry.has_row === false) {
    const def =
      entry.default_enabled === true
        ? "on"
        : entry.default_enabled === false
          ? "off"
          : "unknown";
    badges.push({
      key: "no-row",
      label: `no registry row — default: ${def}`,
      title:
        "No decision has been recorded for this agent type. A row is written " +
        "only when an administrator switches its spawns.",
    });
  } else if (entry && entry.has_row === null) {
    badges.push({
      key: "row-unknown",
      label: "registry row unknown",
      title:
        "Coord could not read the registry rows, so whether this type has a " +
        "recorded decision is unknown.",
    });
  }
  const seen = new Set<string>();
  const push = (b: SourceBadge) => {
    if (seen.has(b.label)) return;
    seen.add(b.label);
    badges.push(b);
  };
  for (const [i, served] of (entry?.sources ?? []).entries()) {
    // Read as the open record it is on the wire: a source this build has no
    // type for must still be named, and its fields are checked, not assumed.
    const source = served as { source: string; [field: string]: unknown };
    const key = `${source.source}-${i}`;
    switch (source.source) {
      case "row":
        break; // the default badge already states the row's choice
      case "declared_role": {
        const repo = typeof source.repo === "string" ? source.repo : null;
        const path = typeof source.path === "string" ? source.path : null;
        const sha = typeof source.sha === "string" ? source.sha : null;
        push({
          key,
          label: repo ? `declared in ${repo}` : "declared in a tenant repo",
          title:
            repo && path
              ? `Role file: ${repo}${sha ? `@${sha.slice(0, 12)}` : ""}:${path}`
              : "Declared as a role file in one of the tenant's repositories.",
        });
        break;
      }
      case "observed": {
        const seen =
          typeof source.last_seen_at === "string" ? source.last_seen_at : null;
        const hint =
          typeof source.spawn_path_hint === "string"
            ? ` The reporting session called it ${source.spawn_path_hint}.`
            : "";
        push({
          key,
          label: `observed ${relativeTime(seen, { now, absent: "at spawn time" })}`,
          title:
            "A session tried to spawn this name and the registry had no row " +
            `for it.${hint}`,
        });
        break;
      }
      case "harness_builtin":
        push({
          key,
          label: "built-in",
          title: "A subagent type built into the Claude Code harness.",
        });
        break;
      case "contract_kind":
      case "contract_class":
        push({
          key,
          label: "spawn kind/class",
          title:
            "A kind or class of session coord itself spawns (the spawn " +
            "authorization contract).",
        });
        break;
      case "runner_key":
        push({
          key,
          label: "runner spawn",
          title: "A name the runner authorizes its own named spawns under.",
        });
        break;
      default:
        push({
          key,
          label: "other source",
          title: `Listed by a catalog source this page has no label for (${source.source}).`,
        });
    }
  }
  return badges;
}

// ── Enforcement reach (plan D7) ──────────────────────────────────────────────

export interface EnforcementLabel {
  /** `full`: something stops the spawn; `partial`: only in some sessions;
   *  `none`: advisory; `unknown`: this page cannot say. */
  reach: "full" | "partial" | "none" | "unknown";
  label: string;
  detail: string;
}

/**
 * What switching this type off actually stops, stated next to the switch
 * (ux-priorities `a-status-signal-must-observe-the-state-it-names`).
 *
 * An Agent-tool subagent (`in_session_subagent`) is stopped only by the
 * client-side guard hook, so outside sessions running the Qontinui hook set
 * the switch is advisory — said in words, never implied by the switch alone.
 */
export function enforcementLabel(line: AgentLine): EnforcementLabel {
  const entry = line.catalog;
  const note = entry?.enforcement_note ? ` ${entry.enforcement_note}` : "";
  const subagent = spawnPathOf(line) === "in_session_subagent";
  const advisoryElsewhere =
    "Enforced in sessions running the Qontinui hook set; advisory elsewhere.";
  switch (entry?.enforcement) {
    case "coord":
      return {
        reach: "full",
        label: "enforced by coord",
        detail: `Coord refuses the spawn itself.${note}`,
      };
    case "runner":
      return {
        reach: "full",
        label: "enforced by the runner",
        detail: `The runner refuses the named spawn.${note}`,
      };
    case "hook":
      return {
        reach: "partial",
        label: "hook-enforced; advisory elsewhere",
        detail: `${advisoryElsewhere}${note}`,
      };
    case "hook_or_advisory":
      return {
        reach: "partial",
        label: "hook-enforced where the hook runs; otherwise advisory",
        detail: `${advisoryElsewhere}${note}`,
      };
    case "advisory":
      return {
        reach: "none",
        label: "advisory",
        detail: `Nothing stops a spawn of this type; the switch records the tenant's decision.${note}`,
      };
    default:
      if (!entry) {
        return {
          reach: "unknown",
          label: "enforcement unknown",
          detail:
            "The catalog was not read, so what this switch stops is unknown.",
        };
      }
      // An enforcement value this build has no label for. A subagent still
      // gets the one statement that is true of every subagent.
      return {
        reach: "unknown",
        label: subagent
          ? "enforcement unknown; advisory outside hooked sessions"
          : "enforcement unknown",
        detail: subagent
          ? `${advisoryElsewhere}${note}`
          : `Coord reported an enforcement this page has no label for.${note}`,
      };
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

export type LineFilter = "all" | "spawns-off" | "off" | "contested";

export function matchesLineFilter(
  line: AgentLine,
  filter: LineFilter
): boolean {
  if (filter === "spawns-off") return spawnSwitchState(line) === "off";
  if (filter === "off") {
    const def = line.row
      ? line.row.default_enabled
      : line.catalog?.default_enabled;
    return def === false;
  }
  if (filter === "contested") {
    return (line.row?.pref_differs_from_default_count ?? 0) > 0;
  }
  return true;
}

export function matchesLineQuery(line: AgentLine, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    line.agent_name.toLowerCase().includes(q) ||
    purposeOf(line).toLowerCase().includes(q)
  );
}
