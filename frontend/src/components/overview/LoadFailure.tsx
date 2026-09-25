/**
 * How an overview page says a read failed. The reader is a business leader,
 * so the first line is a plain sentence about what is missing and what to
 * do; the raw error (status code, proxy body) is kept, folded away, for
 * whoever they forward the screen to.
 */

/** A plain-language cause for the common failure shapes `httpClient`
 *  reports (`"<METHOD> <path> failed: <status> - <body>"`). */
export function describeFailure(message: string): string {
  const status = /failed: (\d{3})\b/.exec(message)?.[1];
  if (status === "401")
    return "Your session has expired. Sign in again to see it.";
  if (status === "403")
    return "Your account doesn't have access to this project's information.";
  if (status && status.startsWith("5"))
    return "The service that holds this information isn't responding right now. Try again in a few minutes.";
  return "Something went wrong while loading it. Try again in a few minutes.";
}

export function LoadFailure({
  what,
  message,
  uiBridgeId,
  announce = true,
}: {
  /** What could not be loaded, e.g. "the project's description". */
  what: string;
  /** The raw error message. */
  message: string;
  uiBridgeId?: string;
  /**
   * Interrupt a screen reader (`role="alert"`). Page-level failures do;
   * per-section ones pass false so several failures are not announced one
   * after another.
   */
  announce?: boolean;
}) {
  return (
    <div
      role={announce ? "alert" : "status"}
      className="border-l-2 border-destructive pl-4"
      data-ui-bridge-id={uiBridgeId}
    >
      <p className="text-[15px] leading-relaxed text-foreground">
        Couldn&rsquo;t load {what}.
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {describeFailure(message)}
      </p>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="inline-block cursor-pointer select-none rounded-sm py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Technical details
        </summary>
        <p className="mt-1 break-all font-mono">{message}</p>
      </details>
    </div>
  );
}
