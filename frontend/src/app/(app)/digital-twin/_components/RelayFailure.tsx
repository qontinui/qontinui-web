"use client";

import { AlertTriangle } from "lucide-react";
import { explainRelayFailure } from "../_lib/relay-error-presentation";

/**
 * The rendered form of a relay failure.
 *
 * Every other panel in this feature surfaces `error.message`; this one's
 * errors are `RunnerRelayError`s carrying a structured body, so it can do
 * better — name the cause when the error establishes one, and hand over the
 * request id so the server logs can be grepped for the rest of the story.
 *
 * It deliberately renders *less* than the strings it replaced when it knows
 * less. The old copy asserted "the app may not be connected to the runner" on
 * every failure, which is a specific and usually wrong diagnosis: the common
 * case is a 503, where the runner never reached the backend at all and the app
 * is not involved.
 *
 * `errors` is a list because the panel fires several queries at one runner. In
 * the dominant failure they all fail the same way, and repeating an identical
 * three-line explanation once per query is noise — but each is a separate HTTP
 * request with its OWN request id, so the ids are collected rather than
 * dropped. Grouping is the caller's decision; see `sharesRelayCause`.
 */
export function RelayFailure({
  errors,
  subject,
}: {
  /** Non-empty: there is always a primary failure to explain. */
  errors: [unknown, ...unknown[]];
  subject: string;
}) {
  const [primary, ...also] = errors;
  const { headline, cause, requestId } = explainRelayFailure(primary, subject);
  const requestIds = [
    ...new Set(
      [
        requestId,
        ...also.map((e) => explainRelayFailure(e, subject).requestId),
      ].filter((id): id is string => id !== undefined)
    ),
  ];

  return (
    // `role="alert"` because this appears asynchronously when a query settles
    // and replaces nothing — without it a screen reader gets no signal that
    // the read failed.
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
      />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{headline}</p>
        {cause && <p className="text-muted-foreground">{cause}</p>}
        {requestIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {requestIds.length === 1 ? "Request " : "Requests "}
            {requestIds.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <code className="break-all">{id}</code>
              </span>
            ))}{" "}
            — grep the backend log for{" "}
            {requestIds.length === 1 ? "this" : "these"}{" "}
            {requestIds.length === 1 ? "id" : "ids"}.
          </p>
        )}
      </div>
    </div>
  );
}
