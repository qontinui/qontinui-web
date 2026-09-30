"use client";

/**
 * "Progress" — the Summary's side column: one proportional bar of the
 * project's work (done, in progress, blocked, planned) and the most recently
 * finished pieces of work. The bar is the page's one bold element; everything
 * around it stays quiet.
 *
 * The counts are the operator console's own (`../_lib/progress.ts` documents
 * the mapping). When they could not be read, the panel says so and shows no
 * figures — an unknown count is never drawn as zero.
 */

import { format, parseISO } from "date-fns";
import {
  PROGRESS_BUCKETS,
  type ProgressBucket,
  type ProgressReading,
  type RecentlyFinished,
} from "../_lib/progress";

/** Fill per bucket. Done is the only saturated colour on the page. */
const BUCKET_FILL: Record<ProgressBucket, string> = {
  done: "bg-[var(--chart-2)]",
  in_progress: "bg-primary",
  blocked: "bg-destructive",
  planned: "bg-muted-foreground/35",
  // Amber: the console's colour for "unknown".
  unknown: "bg-[var(--chart-3)]",
};

/** Buckets always listed, even at zero; the rest only when they hold work. */
const ALWAYS_LISTED: ReadonlySet<ProgressBucket> = new Set([
  "done",
  "in_progress",
  "blocked",
  "planned",
]);

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
}

function RecentlyFinishedList({ recent }: { recent: RecentlyFinished | null }) {
  if (recent === null) {
    return (
      <p
        className="mt-2 text-sm text-muted-foreground"
        data-ui-bridge-id="overview.summary.recently-finished.unknown"
      >
        Recently finished work couldn&rsquo;t be loaded. Try again later.
      </p>
    );
  }
  if (recent.items.length === 0) {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        {recent.partial
          ? "No finish dates were found in what was returned."
          : "Nothing has been finished yet."}
      </p>
    );
  }
  return (
    <>
      <ol
        className="mt-3 space-y-3"
        data-ui-bridge-id="overview.summary.recently-finished"
      >
        {recent.items.map((item) => (
          <li key={`${item.finishedAt}-${item.title}`}>
            <p className="text-sm leading-snug text-foreground">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <time dateTime={item.finishedAt}>
                {formatDate(item.finishedAt)}
              </time>
            </p>
          </li>
        ))}
      </ol>
      {recent.partial && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          The project has finished more work than one read returns, so this list
          may miss something finished recently.
        </p>
      )}
    </>
  );
}

export function ProgressPanel({ reading }: { reading: ProgressReading }) {
  if (!reading.counted) {
    // No figures at all: a count that could not be read is unknown, and a
    // zero here would tell a reader the project has no work.
    return (
      <p
        className="text-[15px] leading-relaxed text-muted-foreground"
        data-ui-bridge-id="overview.summary.progress.unknown"
      >
        This project&rsquo;s progress can&rsquo;t be counted right now (
        {reading.reason}), so no figures are shown. Try again later.
      </p>
    );
  }

  const { counts, total, recentlyFinished } = reading.progress;
  const listed = PROGRESS_BUCKETS.filter(
    (b) => ALWAYS_LISTED.has(b.key) || counts[b.key] > 0
  );

  if (total === 0) {
    return (
      <div data-ui-bridge-id="overview.summary.progress.empty">
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          No work has been planned for this project yet. Pieces of work appear
          here as soon as they are planned.
        </p>
      </div>
    );
  }

  const headline = `${Math.round((counts.done / total) * 100)}%`;
  const caption = `of the planned work is done: ${counts.done} of ${total} pieces of work.`;

  return (
    <div data-ui-bridge-id="overview.summary.progress">
      <p
        className="font-[family-name:var(--font-overview-serif)] text-5xl leading-none text-foreground"
        data-ui-bridge-id="overview.summary.progress.headline"
      >
        {headline}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{caption}</p>

      {/* The id sits on a padded wrapper: the 12px bar itself is too thin
          to be a sensible addressable region. */}
      <div
        className="mt-3.5 py-1.5"
        data-ui-bridge-id="overview.summary.progress.bar"
      >
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={listed
            .map((b) => `${b.label}: ${counts[b.key]}`)
            .join(", ")}
        >
          {PROGRESS_BUCKETS.map((b) =>
            counts[b.key] > 0 ? (
              <div
                key={b.key}
                className={`${BUCKET_FILL[b.key]} h-full border-r-2 border-background last:border-r-0`}
                style={{ width: `${(counts[b.key] / total) * 100}%` }}
              />
            ) : null
          )}
        </div>
      </div>

      <dl className="mt-3 max-w-56 space-y-0.5 text-sm">
        {listed.map((b) => (
          <div
            key={b.key}
            className="flex min-h-6 items-center gap-2"
            data-ui-bridge-id={`overview.summary.progress.${b.key}`}
          >
            <span
              className={`size-2.5 shrink-0 rounded-full ${BUCKET_FILL[b.key]}`}
              aria-hidden
            />
            <dt className="text-muted-foreground">{b.label}</dt>
            <dd className="ml-auto tabular-nums text-foreground">
              {counts[b.key]}
            </dd>
          </div>
        ))}
      </dl>

      {counts.unknown > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {`${counts.unknown} piece${counts.unknown === 1 ? " of work has a status" : "s of work have a status"} this page doesn\u2019t recognise. ${counts.unknown === 1 ? "It counts" : "They count"} toward the total but not as done.`}
        </p>
      )}

      <h3 className="mt-8 font-[family-name:var(--font-overview-serif)] text-lg text-foreground">
        Recently finished
      </h3>
      <RecentlyFinishedList recent={recentlyFinished} />
    </div>
  );
}
