/**
 * One read, as a panel needs to know it — five states, so that none of them
 * can be rendered as another:
 *
 * - `idle` — an on-demand read nobody has asked for yet (the live snapshot,
 *   page health). Nothing to show, and nothing claimed.
 * - `loading` — asked, not answered, nothing kept.
 * - `ok` — answered with a body this page could read. `stale` is true when
 *   the LATEST refetch failed and this is an earlier read's value: kept, and
 *   labelled (style guide R6), never presented as re-confirmed.
 * - `failed` — the read failed, or answered with a body this page could not
 *   read; `issue` says which, in `relaySource.ts`'s vocabulary.
 *
 * The derivation is pure over the fields React Query exposes, so it is tested
 * without a query client.
 */

import { sourceIssueOf, type SourceIssue } from "./relaySource";

export type ReadState<T> =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | {
      readonly state: "ok";
      readonly value: T;
      readonly stale: boolean;
      /** When the kept value was read (epoch ms), or null when unknown. */
      readonly asOf: number | null;
    }
  | { readonly state: "failed"; readonly issue: SourceIssue };

/** The React Query fields a read state is derived from. */
export interface QueryView<D> {
  readonly data: D | undefined;
  readonly error: unknown;
  readonly isError: boolean;
  readonly isFetching: boolean;
  /** React Query's `dataUpdatedAt` — 0 when nothing was ever read. */
  readonly dataUpdatedAt: number;
  /** `fetchStatus === "idle"` with no data and no error: never asked. */
  readonly asked: boolean;
}

/** The issue for an answer that arrived but could not be read. */
export const UNREADABLE_ANSWER: SourceIssue = {
  kind: "failed",
  cause: "the runner answered, but not in the shape this page reads",
  requestId: null,
};

/**
 * The read state of a query whose body `read` turns into a value (or `null`
 * when the body is not what it should be).
 */
export function readStateOf<D, T>(
  query: QueryView<D>,
  read: (data: D) => T | null
): ReadState<T> {
  if (query.data !== undefined) {
    const value = read(query.data);
    if (value === null) return { state: "failed", issue: UNREADABLE_ANSWER };
    return {
      state: "ok",
      value,
      stale: query.isError,
      asOf: query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null,
    };
  }
  if (query.isError) {
    return { state: "failed", issue: sourceIssueOf(query.error) };
  }
  if (!query.asked) return { state: "idle" };
  return { state: "loading" };
}

/** A React Query result as a {@link QueryView}. */
export function queryView<D>(q: {
  data: D | undefined;
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  fetchStatus: "fetching" | "paused" | "idle";
}): QueryView<D> {
  return {
    data: q.data,
    error: q.error,
    isError: q.isError,
    isFetching: q.isFetching,
    dataUpdatedAt: q.dataUpdatedAt,
    asked: !(q.fetchStatus === "idle" && q.data === undefined && !q.isError),
  };
}
