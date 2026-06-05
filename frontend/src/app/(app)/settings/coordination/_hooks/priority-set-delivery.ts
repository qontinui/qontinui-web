/**
 * Pure helpers for the "Priority sets" coordination-settings section.
 *
 * These are the honesty-gate computations: a priority set is only "delivered
 * to agents" if some ENABLED composition rule's `layers` references it by name.
 * Kept free of React / I/O so they can be unit-tested in isolation.
 */

// ---- row shapes (mirror coord #355 / web #465 proxy responses) --------------

/** An `ordering` entry is either a bare name or a weighted object. */
export type OrderingEntry = string | { name: string; weight?: number; min_bar?: number };

export interface PrioritySetRow {
  priority_set_id: string;
  set_name: string;
  /** null = tenant-wide (applies regardless of repo). */
  repo: string | null;
  ordering: OrderingEntry[];
  non_factors: string[];
  version: number;
  enabled: boolean;
  /** true = system default — immutable, no edit/delete affordances. */
  is_system: boolean;
}

export type CompositionLayerRole = "filter" | "lead" | "tiebreaker";

export interface CompositionLayer {
  set: string;
  role: CompositionLayerRole;
}

export interface CompositionRuleRow {
  composition_rule_id: string;
  decision_domain: string;
  surface: string;
  activity: string | null;
  layers: CompositionLayer[];
  tenant_id: string | null;
  priority: number;
  enabled: boolean;
  is_system: boolean;
}

// ---- normalization ----------------------------------------------------------

/** Normalize an `ordering` entry to its bare display name. */
export function orderingEntryName(entry: OrderingEntry): string {
  return typeof entry === "string" ? entry : entry.name;
}

/** Normalize a full `ordering` array to bare display names. */
export function orderingNames(ordering: OrderingEntry[]): string[] {
  return ordering.map(orderingEntryName);
}

// ---- delivery computation (the honesty gate) --------------------------------

export interface SetDelivery {
  /** true iff at least one enabled rule's layers references this set by name. */
  delivered: boolean;
  /** Distinct surfaces (sorted) of the enabled rules that carry this set. */
  surfaces: string[];
}

/**
 * Compute, for a single set name, whether any ENABLED composition rule carries
 * it and on which surfaces. A set named by only disabled rules is NOT delivered.
 */
export function computeSetDelivery(
  setName: string,
  rules: CompositionRuleRow[]
): SetDelivery {
  const surfaces = new Set<string>();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.layers.some((l) => l.set === setName)) {
      surfaces.add(rule.surface);
    }
  }
  const sorted = Array.from(surfaces).sort();
  return { delivered: sorted.length > 0, surfaces: sorted };
}

/** Build a `set_name -> SetDelivery` map for a batch of sets. */
export function computeDeliveryMap(
  sets: PrioritySetRow[],
  rules: CompositionRuleRow[]
): Record<string, SetDelivery> {
  const map: Record<string, SetDelivery> = {};
  for (const s of sets) {
    map[s.set_name] = computeSetDelivery(s.set_name, rules);
  }
  return map;
}

// ---- error classification ---------------------------------------------------

/**
 * The web proxy surfaces coord errors as `{"error":"<code>"}` with a 4xx
 * status. The HttpClient re-throws those as an Error whose message embeds the
 * raw body text (e.g. `POST ... failed: 409 - {"error":"duplicate_set_name"}`).
 * Map known codes to friendly, inline-displayable copy.
 */
export function friendlyCoordError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("duplicate_set_name")) {
    return "A priority set with that name already exists. Choose a different name.";
  }
  if (raw.includes("system_row_immutable")) {
    return "That set is a system default and cannot be changed.";
  }
  if (raw.includes("admin_required")) {
    return "You need coord-tenant admin access to make this change.";
  }
  if (raw.includes(" 403")) {
    return "You need coord-tenant admin access to make this change.";
  }
  return raw;
}

// ---- slug helpers -----------------------------------------------------------

/** Normalize free text into a coord set-name slug (lowercase, _-separated). */
export function slugifySetName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
