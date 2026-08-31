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
 */
export function RelayFailure({
  error,
  subject,
}: {
  error: unknown;
  subject: string;
}) {
  const { headline, cause, requestId } = explainRelayFailure(error, subject);

  return (
    <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{headline}</p>
        {cause && <p className="text-muted-foreground">{cause}</p>}
        {requestId && (
          <p className="text-xs text-muted-foreground">
            Request <code className="break-all">{requestId}</code> — grep the
            backend log for this id.
          </p>
        )}
      </div>
    </div>
  );
}
