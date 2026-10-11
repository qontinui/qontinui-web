/**
 * `/operations/fleet/*` controls and their dashboard reads: the drain, the
 * per-device worktree cap, the worktree allocation slots and the dispatch
 * roles.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline and states
 * its retry policy.
 *
 * The reads and writes that return `Response` do so on purpose: each caller
 * maps a 404 (coord a deploy behind the console), a non-2xx status and an
 * unreadable 2xx body to DIFFERENT operator-facing facts (UNKNOWN versus a
 * refusal versus a landed write), so folding them into one thrown error would
 * lose the distinction. {@link fetchFleetWorktreeSlots} has no such caller and
 * parses through `readJson`.
 *
 * Handlers mirrored live in `backend/app/api/v1/endpoints/operations/`; each
 * is a proxy of the matching coord `/coord/fleet/*` route.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One occupant of an allocated worktree slot, as coord's `BudgetOccupant` serializes it. */
export interface WorktreeSlotOccupantRow {
  repo: string;
  worktree_path: string;
  /** Seconds since the worktree was allocated — feed to `formatAge`. */
  age_secs: number | null;
  building?: boolean | null;
}

/**
 * Coord's `BudgetOccupancy::bounded` shape, reused verbatim by the fleet
 * route — the same renderer the per-device allocation-budget door and its
 * refusal detail already use, so this list and that one cannot drift.
 */
export interface WorktreeSlotOccupancy {
  shown: number;
  total: number;
  truncated: boolean;
  rows: WorktreeSlotOccupantRow[];
}

export interface WorktreeSlotDevice {
  device_id: string;
  hostname: string | null;
  active_worktrees: number;
  max_worktrees: number;
  /**
   * Count of `coord.worktree_census` rows for this device within the narrow
   * (`census_window_secs`) window — NOT the per-device door's 24h-windowed
   * `census_rows_observed`, a different field with a different meaning.
   *
   * `0` means coord has no recent census hit for this device, so
   * `active_worktrees` could not be corroborated as live and MUST be
   * rendered UNKNOWN by the caller — never an idle/empty machine and never
   * a healthy `0/8`. See `FleetWorktreeSlotsSection`.
   */
  census_recent_rows: number;
  occupants: WorktreeSlotOccupancy;
}

export interface WorktreeSlotsResponse {
  tenant_id: string;
  device_count: number;
  truncated: boolean;
  device_cap: number;
  census_window_secs: number;
  devices: WorktreeSlotDevice[];
}

/** `GET /fleet/drain` — the per-device drain state. A poll: no client retries. */
export function fetchFleetDrain(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/drain`, {
    method: "GET",
    maxRetries: 0,
  });
}

/** `POST /fleet/drain` — drain one device until a time, with a reason. */
export function postFleetDrain(
  body: Record<string, string>
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/drain`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** `POST /fleet/undrain` — lift a device's drain; coord requires a reason. */
export function postFleetUndrain(
  body: Record<string, string>
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/undrain`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** `GET /fleet/worktree-cap` — the per-device worktree caps. A poll: no client retries. */
export function fetchFleetWorktreeCap(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/worktree-cap`, {
    method: "GET",
    maxRetries: 0,
  });
}

/** `POST /fleet/worktree-cap` — set one device's cap. */
export function postFleetWorktreeCap(
  body: Record<string, string | number>
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/worktree-cap`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** `POST /fleet/worktree-cap/clear` — remove one device's cap. */
export function postFleetWorktreeCapClear(
  body: Record<string, string | number>
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/worktree-cap/clear`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * `GET /fleet/worktree-slots` — the allocation-slot surface. A poll: no client
 * retries (`maxRetries: 0`), the next tick is the retry.
 */
export async function fetchFleetWorktreeSlots(): Promise<WorktreeSlotsResponse> {
  const url = `${OPERATIONS_BASE}/fleet/worktree-slots`;
  const res = await httpClient.fetch(url, { method: "GET", maxRetries: 0 });
  return readJson<WorktreeSlotsResponse>(res, `GET ${url}`);
}

/** `GET /fleet/dispatch-roles` — every machine's dispatch role. A poll: no client retries. */
export function fetchFleetDispatchRoles(): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/dispatch-roles`, {
    method: "GET",
    maxRetries: 0,
  });
}

/**
 * `PUT /fleet/dispatch-role` — set one machine's role. Never auto-retried
 * (`maxRetries: 0`): coord answers a repeated PUT with `changed: false`, so a
 * retry after a lost-but-committed first attempt would report "nothing
 * changed" for a change the operator just made.
 */
export function putFleetDispatchRole(
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/fleet/dispatch-role`, {
    method: "PUT",
    body: JSON.stringify(body),
    maxRetries: 0,
  });
}
