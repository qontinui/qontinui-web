/**
 * `/operations/coord/dossiers` — the dossier query door: one keyset page of
 * dossier heads under the page's filters and sort.
 *
 * Plan `2026-10-03-dossier-query-door-filters-sort-cursor`, Phase 5. Same
 * conventions as `coordFindings.ts`: `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting with
 * `GET <url> failed: <status> - <body>`, so coord's own refusal (a 400 on a
 * stale cursor or a malformed date) reaches the page unchanged.
 *
 * Handler: `get_coord_dossiers` in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, which forwards to
 * coord's `GET /coord/dossiers` (`findings::dossiers::get_dossiers`). The
 * proxy degrades an unanswering coord into an `unavailable` envelope rather
 * than a 502, so the read resolves `unknown` and the page reads the body
 * defensively.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** coord's `sort` vocabulary (`DOSSIER_SORTS`). */
export type DossierSort =
  | "last_seen"
  | "first_seen"
  | "updated"
  | "recurrence_count"
  | "slug";

/**
 * The query `GET /coord/dossiers` honours. An absent, empty or `null` key is
 * omitted, never sent empty — coord would read an empty value as a filter.
 */
export interface DossiersQuery {
  /** Page size asked of coord. Coord owns the clamp; this is a request. */
  limit: number;
  /** Repeated `readiness=` keys; `none` selects a NULL readiness. */
  readiness?: readonly string[];
  /** Repeated `remediation_state=` keys (the live roll-up, plan D6). */
  remediationState?: readonly string[];
  q?: string;
  recurrenceMin?: number | null;
  recurrenceMax?: number | null;
  /** ISO `YYYY-MM-DD`. */
  lastSeenSince?: string;
  lastSeenUntil?: string;
  /** `null` / absent sends no key (either). */
  hasOpenRemediation?: boolean | null;
  sort?: DossierSort;
  order?: "asc" | "desc";
  /** Only ever a `next_cursor` coord minted for THIS query — never invented. */
  cursor?: string | null;
}

/** Build the query string, in a fixed key order (the tests pin it). */
export function dossiersQueryString(query: DossiersQuery): string {
  const qs = new URLSearchParams();
  qs.set("limit", String(query.limit));
  for (const r of query.readiness ?? []) qs.append("readiness", r);
  for (const s of query.remediationState ?? [])
    qs.append("remediation_state", s);
  if (query.q) qs.set("q", query.q);
  if (typeof query.recurrenceMin === "number")
    qs.set("recurrence_min", String(query.recurrenceMin));
  if (typeof query.recurrenceMax === "number")
    qs.set("recurrence_max", String(query.recurrenceMax));
  if (query.lastSeenSince) qs.set("last_seen_since", query.lastSeenSince);
  if (query.lastSeenUntil) qs.set("last_seen_until", query.lastSeenUntil);
  if (
    query.hasOpenRemediation !== null &&
    query.hasOpenRemediation !== undefined
  )
    qs.set("has_open_remediation", String(query.hasOpenRemediation));
  if (query.sort) qs.set("sort", query.sort);
  if (query.order) qs.set("order", query.order);
  if (query.cursor) qs.set("cursor", query.cursor);
  return qs.toString();
}

/** `GET /coord/dossiers?…` (handler `get_coord_dossiers`) — one page. */
export async function fetchCoordDossiers(
  query: DossiersQuery
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/dossiers?${dossiersQueryString(query)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}
