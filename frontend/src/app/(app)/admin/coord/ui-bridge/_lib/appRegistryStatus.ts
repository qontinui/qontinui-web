/**
 * The app registry — every application the fleet knows how to drive, as the
 * WEB records it and as the targeted RUNNER records it, merged into one row
 * per app id (style guide R8: the derivation lives here, not in JSX).
 *
 * Two sources, read independently, so either can be missing:
 *
 * - **web** — `GET /api/v1/fleet/apps` (backend `fleet_targets.py`
 *   `list_apps`): the `project.apps` rows on shared Postgres,
 *   `{ app_id, display_name, repo_root, update_strategy, build_command,
 *   start_command }`. No runner needed.
 * - **runner** — the runner's own `GET /apps` over the relay (the digital
 *   twin's `useRunnerApps`): `{ ok, apps: [App] }` with qontinui-schemas
 *   `rust/src/apps.rs` `App` rows, which add `ui_bridge_url` and
 *   `last_seen_at_ms`. A runner on its embedded database keeps its own rows,
 *   so the two registries can legitimately differ.
 *
 * **Presence is a cross-registry claim, so it needs both answers.** With both
 * registries read, an app is on both, the web only, or this runner only —
 * three calm facts (a registry difference is a deployment shape, not a
 * fault). With either unread, whether the other side has the app is UNKNOWN,
 * and the row says so rather than reading "web only" off a runner that never
 * answered (R3's ignorance floor, amber).
 *
 * **Neither registry is kept per project, so neither is read while
 * presenting** (plan `2026-10-23-console-presentation-spaces` D3.4: a lens page
 * fetches only the acting organisation's data). The web's `list_apps` returns
 * every row of `project.apps` to any signed-in user, and the runner's own
 * `GET /apps` lists every row of its database's apps table (qontinui-runner
 * `spec_api/apps.rs` `handle_list_apps`), which on a runner bound to the
 * shared database is that same table. Each half is then a {@link RegistryRead}
 * of `not-read`, and the panel renders its reason as a labelled UNKNOWN.
 *
 * **Nor is the web registry read for anyone but staff**, in operator mode
 * either. The menu is not what stands between a viewer and that read: any
 * signed-in member can open the page's URL, and the route answers any of them
 * with every row. So until `list_apps` is scoped to the acting organisation
 * the page makes the read only for staff (`is_superuser`), and every other
 * viewer reads that half as `not-read` with {@link WEB_REGISTRY_STAFF_ONLY}.
 * The page still asks for the runner's own list in operator mode, whoever is
 * viewing: the relay reaches only a runner the viewer owns, so that list is
 * what the viewer's own runner can already read.
 */

import {
  INERT,
  UNKNOWN_AMBER,
  type AttentionMap,
  type StatusPalette,
} from "@/components/console";
import type { RegisteredApp } from "@/app/(app)/digital-twin/_lib/ui-bridge-types";
import type { ReadState } from "./readState";

/**
 * One registry's read as the panel holds it: the read, or `not-read` with the
 * reason this render does not make it — never an empty list.
 */
export type RegistryRead<T> =
  | ReadState<T>
  | { readonly state: "not-read"; readonly reason: string };

/** Why the presentation lens does not read the web registry (D3.4). */
export const WEB_REGISTRY_NOT_IN_LENS =
  "The web app registry is not read while presenting: it is not kept per project, so it can list other projects' applications.";

/**
 * Why the page does not read the web registry for a viewer who is not staff,
 * in operator mode: the route answers any signed-in user with every row, so
 * the page makes the read only for staff until it is scoped to the acting
 * organisation.
 */
export const WEB_REGISTRY_STAFF_ONLY =
  "The web app registry is read only for staff: it is not kept per project, so it can list other projects' applications.";

/** Why the presentation lens does not read the runner's own app list (D3.4). */
export const RUNNER_APP_LIST_NOT_IN_LENS =
  "This runner's own app list is not read while presenting: a runner on the shared database lists every application registered there, not only this project's.";

/** One `GET /api/v1/fleet/apps` row (backend `schemas/fleet_targets.py` `AppConfig`). */
export interface WebAppConfig {
  app_id: string;
  display_name: string;
  repo_root: string;
  update_strategy: string;
  build_command: string | null;
  start_command: string | null;
}

export type AppPresenceKind = "both" | "web-only" | "runner-only" | "unknown";

/**
 * Who must act on a row's presence: nobody for the three answered shapes;
 * WAITING — the ignorance floor — when one registry did not answer.
 */
export const APP_PRESENCE_ATTENTION_BY_KIND = {
  both: "none",
  "web-only": "none",
  "runner-only": "none",
  unknown: "waiting",
} satisfies AttentionMap<AppPresenceKind>;

export const APP_PRESENCE_BADGE_CLASS: Record<AppPresenceKind, string> = {
  both: INERT,
  "web-only": INERT,
  "runner-only": INERT,
  unknown: UNKNOWN_AMBER,
};

export const APP_PRESENCE_AUTHOR_GLYPH_KINDS: ReadonlySet<AppPresenceKind> =
  new Set<AppPresenceKind>();

export const APP_PRESENCE_PALETTE: StatusPalette<AppPresenceKind> = {
  badgeClass: APP_PRESENCE_BADGE_CLASS,
  authorGlyphKinds: APP_PRESENCE_AUTHOR_GLYPH_KINDS,
};

export const APP_PRESENCE_LABEL: Record<AppPresenceKind, string> = {
  both: "web and runner",
  "web-only": "web only",
  "runner-only": "this runner only",
  unknown: "UNKNOWN",
};

export interface AppRow {
  readonly appId: string;
  /** The web registry's name, else the runner's; null when neither names it. */
  readonly displayName: string | null;
  readonly presence: AppPresenceKind;
  /** Whether the web registry has it; null when the web was not read. */
  readonly inWeb: boolean | null;
  /** Whether this runner has it; null when the runner was not read. */
  readonly onRunner: boolean | null;
  /** `pull_only` / `pull_build`, from whichever registry has the row. */
  readonly updateStrategy: string | null;
  /** When this runner last saw the app (epoch ms), or null. */
  readonly lastSeenAtMs: number | null;
  readonly uiBridgeUrl: string | null;
  /** The checkout path the registry recorded — a local path, operator-only. */
  readonly repoRoot: string | null;
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Merge the two registries. `null` for a side that did not answer. Returns
 * `null` when NEITHER answered — there are no rows to show, and "no apps"
 * would be a claim neither registry made.
 */
export function mergeAppRegistries(
  web: readonly WebAppConfig[] | null,
  runner: readonly RegisteredApp[] | null
): AppRow[] | null {
  if (web === null && runner === null) return null;
  const webById = new Map<string, WebAppConfig>();
  for (const app of web ?? []) {
    const id = text(app?.app_id);
    if (id && !webById.has(id)) webById.set(id, app);
  }
  const runnerById = new Map<string, RegisteredApp>();
  for (const app of runner ?? []) {
    const id = text(app?.app_id);
    if (id && !runnerById.has(id)) runnerById.set(id, app);
  }
  const ids = [...new Set([...webById.keys(), ...runnerById.keys()])].sort();
  return ids.map((appId) => {
    const w = webById.get(appId);
    const r = runnerById.get(appId);
    const inWeb = web === null ? null : w !== undefined;
    const onRunner = runner === null ? null : r !== undefined;
    const presence: AppPresenceKind =
      inWeb === null || onRunner === null
        ? "unknown"
        : inWeb && onRunner
          ? "both"
          : inWeb
            ? "web-only"
            : "runner-only";
    const lastSeen = r?.last_seen_at_ms;
    return {
      appId,
      displayName: text(w?.display_name) ?? text(r?.display_name),
      presence,
      inWeb,
      onRunner,
      updateStrategy: text(w?.update_strategy) ?? text(r?.update_strategy),
      lastSeenAtMs:
        typeof lastSeen === "number" &&
        Number.isFinite(lastSeen) &&
        lastSeen > 0
          ? lastSeen
          : null,
      uiBridgeUrl: text(r?.ui_bridge_url),
      repoRoot: text(w?.repo_root) ?? text(r?.repo_root),
    };
  });
}

/** The strategies this build knows by name. */
export const KNOWN_UPDATE_STRATEGIES: ReadonlySet<string> = new Set([
  "pull_only",
  "pull_build",
]);

/**
 * An update strategy in an operator's words, from a FIXED vocabulary: a value
 * this build does not know is "other", never echoed. The string comes from a
 * registry, and the row's reason renders in presentation mode too, so the
 * page's own word is what reaches it (D3.3 fails closed); the operator's raw
 * line shows the value itself.
 */
export function updateStrategyLabel(strategy: string | null): string {
  switch (strategy) {
    case "pull_only":
      return "pull only";
    case "pull_build":
      return "pull and build";
    case null:
      return "–";
    default:
      return "other";
  }
}

/** How many rows each presence kind has — the panel's counts. */
export function presenceCounts(
  rows: readonly AppRow[]
): Record<AppPresenceKind, number> {
  const out: Record<AppPresenceKind, number> = {
    both: 0,
    "web-only": 0,
    "runner-only": 0,
    unknown: 0,
  };
  for (const row of rows) out[row.presence] += 1;
  return out;
}

/** One of the two registries this page reads. */
export type AppRegistrySide = "web" | "runner";

const SIDE_NAME: Record<AppRegistrySide, string> = {
  web: "the web registry",
  runner: "this runner's app list",
};

/**
 * How many apps the two registries hold between them, as this page can state
 * it (R6's dash, and the `≥N` floor the CI dashboard uses for a count it can
 * only bound — `ci/_lib/ciDashboardStatus.ts`):
 *
 * - `exact` — both registries answered: every app is counted;
 * - `floor` — one did not: an app only the unread one records is not
 *   counted, so N means "at least N";
 * - `unknown` — neither answered, or the one that did records none: a floor
 *   of zero says nothing, and "0 apps" would be a claim the unread registry
 *   never made.
 *
 * Today every runner's app list is unread (no relay carries `GET /apps` —
 * `relayReads.ts`), so for staff this is a floor on every runner until one
 * does. For any other viewer the web registry is not read either, and while
 * presenting neither registry is read, so for both it is `unknown`.
 */
export type AppTotal =
  | { readonly kind: "exact"; readonly count: number }
  | {
      readonly kind: "floor";
      readonly count: number;
      readonly unread: AppRegistrySide;
    }
  | { readonly kind: "unknown"; readonly unread: AppRegistrySide | "both" };

/** The total of `rows`, given which registries answered. */
export function appTotalOf(
  rows: readonly AppRow[] | null,
  answered: { readonly web: boolean; readonly runner: boolean }
): AppTotal {
  if (rows === null || (!answered.web && !answered.runner)) {
    return { kind: "unknown", unread: "both" };
  }
  if (answered.web && answered.runner) {
    return { kind: "exact", count: rows.length };
  }
  const unread: AppRegistrySide = answered.web ? "runner" : "web";
  return rows.length === 0
    ? { kind: "unknown", unread }
    : { kind: "floor", count: rows.length, unread };
}

/** The total as a badge value: `3`, `≥3`, or null (renders `–`). */
export function appTotalValue(total: AppTotal): number | string | null {
  switch (total.kind) {
    case "exact":
      return total.count;
    case "floor":
      return `≥${total.count}`;
    case "unknown":
      return null;
  }
}

/** What the total means, in words — its badge's title. */
export function appTotalMeaning(total: AppTotal): string {
  switch (total.kind) {
    case "exact":
      return "Applications across the web and runner registries";
    case "floor":
      return `At least ${total.count}: ${SIDE_NAME[total.unread]} was not read, so an app only it records is not counted`;
    case "unknown": {
      if (total.unread === "both") {
        return "Neither registry was read, so how many apps exist is unknown";
      }
      const read = SIDE_NAME[total.unread === "web" ? "runner" : "web"];
      return `${read.charAt(0).toUpperCase()}${read.slice(1)} records none and ${SIDE_NAME[total.unread]} was not read, so how many apps exist is unknown — not none`;
    }
  }
}
