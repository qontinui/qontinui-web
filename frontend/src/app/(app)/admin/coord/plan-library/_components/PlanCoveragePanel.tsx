"use client";

/**
 * PlanCoveragePanel — how much of what EXISTS the corpus actually holds, per
 * scan source, rendered as the SET DIFFERENCE it is.
 *
 * Phase 4 of `2026-09-15-captured-vs-authored-coverage-is-a-set-difference`.
 * Phase 3 put the difference on the wire; this is the only surface that shows
 * it to a human, so every rule the backend spent that phase enforcing has to
 * survive the last inch to the screen — or the defect simply moves here.
 *
 * ## Why there is no headline percentage
 *
 * The naive figure this panel replaces read **101.8%** in production, which is
 * not a rounding error but a category error: one number was divided by one
 * denominator while its numerator was drawn from a WIDER set. Three separate
 * things make a single ratio unstateable here, and each has its own line on
 * this panel rather than a footnote:
 *
 * 1. **There are two denominators, and they answer different questions.**
 *    `authored_at_ref` is what EXISTS at the default branch; `visible_to
 *    _scanner` is what the body sync could POSSIBLY have seen in the working
 *    tree it scans. A checkout 254 commits behind makes the second much
 *    smaller than the first, and a share over either one alone is a different
 *    claim.
 * 2. **Rows under another key inflate a numerator.** Plan rows written under a
 *    different `source_repo` — or none — are counted by
 *    `out_of_scope_artifact_count`, and sweeping them into a numerator is
 *    exactly what produced the impossible figure. So this panel renders that
 *    count as a VISIBLE line, not a footnote: it is the term whose omission
 *    made the old number wrong.
 * 3. **The authored side is as of a ref, never the live tip.** `min_behind`
 *    and `ref_sha` sit beside the numbers for that reason.
 *
 * A percentage is therefore permitted here in exactly one place: inside the
 * sentence that has already named BOTH denominators and said which of the two
 * the share is over ([`denominatorSentence`]). It is never a headline, never a
 * badge, and never rendered when either side is missing. Its numerator
 * (`both`) is a subset of its denominator (the authored side) by construction,
 * so unlike the figure it replaces it cannot exceed 100% — and the sentence
 * says so.
 *
 * ## `unknown` is a sentence, never a zero
 *
 * `state: "unknown"` means EVERY count is `null`. The backend refuses to omit
 * the key (which would read as "no such scan source") and refuses to zero it
 * (which would read as "the corpus holds none of it"), and it ships a `detail`
 * naming which of the three rules fired — `no_census:`, `census_truncated:`,
 * `source_repo_unnamed:`. This panel renders that as a
 * "not established, because …" sentence and renders NO numbers at all for
 * that key: a row of `–` badges beside a real row of integers is read at a
 * glance as small numbers, and the whole point is that nothing was measured.
 * `min_behind` and the device identity ARE still shown, because the backend
 * carries them on an `unknown` entry deliberately — they do not come from the
 * census.
 *
 * An EMPTY `coverage` array is the same rule one level up: it is not "nothing
 * is missing". `coverage_detail` says which of the reasons produced it
 * (`not_computed_here:`, `read_failed:`, `no_observation:`) and this panel
 * renders that instead of an empty panel.
 *
 * ## Style
 *
 * An operator/monitoring surface, so it composes the console primitives
 * (`components/console` — `StatCluster` for the count opening) and the shared
 * classes, in the same section shell as its two siblings on this page. It
 * carries its own Refresh for the reason `CaptureHealthPanel` states: an
 * operator who can re-ask only one panel ends up comparing a fresh reading
 * against counts of unknown age.
 */

import { AlertTriangle, Layers, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCluster } from "@/components/console";
import { usePlanCoverage } from "../_hooks/usePlanLibrary";
// The rounding rule in `shortDuration` is load-bearing — it floors the unit
// and appends `+` so an age is never rendered as fresher than it is — and a
// byte-identical second copy is a rule that can drift in one place and not the
// other. It is imported rather than moved to a shared module because
// `ScanSourcesPanel.tsx` has an open pull request against it (#1332) and a
// file move for a formatter's sake is not worth the conflict. If a third
// caller appears, move it into `_components/duration.ts` then.
import { shortDuration } from "./ScanSourcesPanel";
import type { PlanCensusSide, PlanCoverage } from "../types";

/** How a coverage verdict is labelled. `unknown` never reads as a quantity. */
export function coverageStateLabel(state: PlanCoverage["state"]): string {
  return state === "measured" ? "Measured" : "Not established";
}

/**
 * An entry's addressing key, which no two entries can share.
 *
 * The same construction `rollupKey` uses in `ScanSourcesPanel`, and for the
 * same reason: `source_repo` is free text, so a source named `state-foo/plans`
 * would otherwise collide with the state badge of `foo/plans`, and any literal
 * stand-in for the `null` group could collide with a source actually spelled
 * that way.
 */
export function coverageKey(sourceRepo: string | null): string {
  return sourceRepo === null ? "null" : `repo=${sourceRepo}`;
}

/**
 * A backend `detail` split into its machine prefix and its prose.
 *
 * Every `detail` the route emits starts `<reason>: <sentence>`. The prefix is
 * what an operator greps for and what a future rule is added under, so it is
 * kept verbatim in a `<code>` rather than being prettified away; the prose is
 * already a complete sentence and is rendered as one.
 *
 * A `detail` in an unrecognised shape (no `: `) is returned whole as the
 * prose with no reason — never silently dropped, and never guessed at.
 */
export function splitDetail(detail: string): {
  reason: string | null;
  prose: string;
} {
  const at = detail.indexOf(": ");
  if (at <= 0) return { reason: null, prose: detail };
  return { reason: detail.slice(0, at), prose: detail.slice(at + 2) };
}

/**
 * Why this key establishes nothing — the sentence that replaces the numbers.
 *
 * Written so the reason is the SUBJECT, because "not established" on its own
 * is the answer an operator cannot act on. A `null` detail is a response this
 * build was not written for (the route always sends one on `unknown`), and it
 * still must not read as zero, so it says outright that no reason was served.
 */
export function notEstablishedSentence(entry: PlanCoverage): string {
  if (!entry.detail) {
    return (
      "How much of what exists the corpus holds is not established here, and " +
      "the route served no reason — which is not 0 captured and not full " +
      "coverage."
    );
  }
  const { prose } = splitDetail(entry.detail);
  return `How much of what exists the corpus holds is not established here, because ${uncapitalise(prose)}`;
}

/**
 * Lower-case an opening word that is ORDINARY PROSE, and nothing else.
 *
 * Every `detail` today opens lower-case already, so this only ever fires on a
 * reason not yet written. Blindly lowering the first character would then
 * mangle exactly the openings worth preserving — a sha, an identifier, an
 * acronym (`SHA`, `POST`), a `source_repo` — and the clause is spliced after
 * "because", where a mangled token is both wrong and ungreppable. So the
 * transform applies only to a capitalised word followed by a lower-case
 * letter, which no identifier or acronym matches.
 */
function uncapitalise(prose: string): string {
  return /^[A-Z][a-z]/.test(prose)
    ? `${prose.charAt(0).toLowerCase()}${prose.slice(1)}`
    : prose;
}

/** `n` rendered with its noun pluralised. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A share, to one decimal, that NEVER rounds into a claim it cannot make —
 * used ONLY by [`denominatorSentence`].
 *
 * A bare `toFixed(1)` is wrong in both directions at the ends of the range,
 * and both errors are the exact class this feature exists to delete:
 *
 * * **9999 of 10000 rounds to `100.0%`**, printed inside the same sentence
 *   that asserts the share cannot exceed 100% and directly above a missing
 *   count of 1. Full coverage, rendered for an incomplete corpus.
 * * **1 of 10000 rounds to `0.0%`**, which reads as "the corpus holds none of
 *   it" when it holds some — absence-is-not-zero, one level down.
 *
 * So the two ends are reserved for the EXACT cases and everything between
 * them is hedged with `>` or `<`, the same shape `shortDuration`'s `+` gives
 * an age. `100%` and `0%` are then load-bearing: they mean exactly that.
 */
function share(numerator: number, denominator: number): string {
  if (numerator === denominator) return "100%";
  if (numerator === 0) return "0%";
  const rounded = ((numerator / denominator) * 100).toFixed(1);
  if (rounded === "100.0") return ">99.9%";
  if (rounded === "0.0") return "<0.1%";
  return `${rounded}%`;
}

/**
 * Both denominators, named — and the one place a percentage may appear.
 *
 * The sentence is built in this order on purpose: the two denominators FIRST,
 * as two different questions, and only then a share that says which of the two
 * it is over. Reversing that order produces the figure this whole feature
 * exists to delete — a percentage an operator reads before learning there were
 * ever two candidate denominators.
 *
 * Four guards, and each corresponds to a shape the route really emits:
 *
 * * **Either side `null`** — an `unknown` entry. No sentence at all; the
 *   caller renders [`notEstablishedSentence`] instead.
 * * **`both` `null`** — same case, guarded independently because the wire type
 *   allows it on its own.
 * * **An authored side of 0** — a real key with no stems at the ref. `0/0` is
 *   not 100%, so the share is refused in words rather than computed.
 * * **`listed_count`, never `count`** — the difference was taken over the
 *   stems that were SENT. On a truncated census those differ, and a share over
 *   the enumerated total would be a numerator from one set over a denominator
 *   from another, which is the original defect in miniature. (A truncated
 *   census already makes the entry `unknown`, so this is belt and braces.)
 */
export function denominatorSentence(entry: PlanCoverage): string | null {
  const authored = entry.authored_at_ref;
  const visible = entry.visible_to_scanner;
  if (!authored || !visible || entry.both == null) return null;

  const sides =
    `Two denominators, because they answer different questions: ` +
    `${plural(authored.listed_count, "stem")} exist at the ref, and ` +
    `${plural(visible.listed_count, "stem")} were visible in the working tree ` +
    `the body sync scans.`;

  if (authored.listed_count === 0) {
    return (
      `${sides} No stem exists at the ref for this source, so there is no ` +
      `share to state — 0 of 0 is not full coverage.`
    );
  }

  return (
    `${sides} The corpus holds ${entry.both} of the ` +
    `${authored.listed_count} that exist — ${share(entry.both, authored.listed_count)} ` +
    `of THAT side, and not a share of the ${visible.listed_count} the scanner ` +
    `could see. It cannot exceed 100%: what is counted is the overlap, which ` +
    `is part of the set it is divided by.`
  );
}

/**
 * What is missing, and how much of it a lagging checkout already explains.
 *
 * `authored_not_captured_but_invisible` is the attribution field: a stem that
 * is not in the tree the sync scans could not have been captured by it, so it
 * is checkout freshness rather than a capture defect. The remainder — missing
 * AND visible — is the number an operator can act on, and it is stated as its
 * own figure rather than left as a subtraction the reader performs.
 *
 * The attribution is rendered only when it was served. Without it the
 * remainder is unknown, and printing `authored_not_captured` alone invites
 * precisely the misreading this field exists to prevent.
 */
export function missingSentence(entry: PlanCoverage): string | null {
  const missing = entry.authored_not_captured;
  if (missing == null) return null;
  if (missing === 0) {
    return "Every stem that exists at that ref is in the corpus.";
  }
  const invisible = entry.authored_not_captured_but_invisible;
  const head = `${plural(missing, "stem")} that exist at the ref ${missing === 1 ? "is" : "are"} not in the corpus.`;
  if (invisible == null) {
    return `${head} How many of them the scanned tree could not have seen was not served, so how much of this gap is checkout freshness rather than a capture defect is not established.`;
  }
  const actionable = missing - invisible;
  return (
    `${head} ${invisible} of them ${invisible === 1 ? "was" : "were"} not in the tree the sync scans and ` +
    `could not have been captured — checkout freshness, not a capture defect. ` +
    `That leaves ${actionable} that ${actionable === 1 ? "was" : "were"} visible and still missing.`
  );
}

/**
 * Rows the corpus holds that the ref does not — NOT a defect, and never
 * subtracted.
 *
 * A stem can be captured and absent from the ref for ordinary reasons: it was
 * authored on a branch, or deleted upstream after capture (this store is an
 * index, not a backup — deleting a file does not delete history here). So the
 * sentence names it as a fact about the two sets and stops short of a verdict.
 */
export function capturedNotAuthoredSentence(
  entry: PlanCoverage
): string | null {
  const extra = entry.captured_not_authored;
  if (extra == null || extra === 0) return null;
  return (
    `${plural(extra, "captured stem")} under this source ${extra === 1 ? "is" : "are"} not at the ref — ` +
    `authored on a branch, or deleted upstream after capture. Not a coverage ` +
    `defect, and never subtracted from the numbers above.`
  );
}

/**
 * The plan rows that are NOT under this key — the term a naive ratio swallowed.
 *
 * Deliberately a line of its own rather than a footnote or a `title`
 * attribute. This is the count whose omission let a numerator be drawn from a
 * wider set than its denominator, and an operator comparing two keys needs to
 * see that the corpus holds rows neither of them is measuring.
 */
export function outOfScopeSentence(entry: PlanCoverage): string | null {
  const n = entry.out_of_scope_artifact_count;
  if (n == null) return null;
  if (n === 0) {
    return "Every plan row in this organization sits under this scan source.";
  }
  // No figure is quoted here, deliberately. The number this line exists to
  // explain is a percentage that was impossible, and printing it would put a
  // second percentage on a panel whose one permitted percentage lives beside
  // both denominators. The module docstring carries the history.
  return (
    `${plural(n, "plan row")} in this organization sit under a different scan ` +
    `source, or under none. They are outside this difference and are never ` +
    `subtracted from it — counting them in a numerator is what made the old ` +
    `coverage figure impossible, a numerator drawn from a wider set than its ` +
    `denominator.`
  );
}

/**
 * How far behind the feeder is, carried onto the entry so no join is needed.
 *
 * The same three rules the roll-up states, because they are the same number:
 * `null` is NOT ESTABLISHED and never `0`; a floor is "at least N"; and an
 * exact count is exact only as of a ref some comparable device had fetched
 * recently, never against the live tip the server never sees.
 *
 * It is rendered on an `unknown` entry too — the backend carries it there on
 * purpose, since it comes from the roll-up rather than from the census.
 */
export function distanceSentence(entry: PlanCoverage): string {
  if (entry.min_behind == null || entry.min_behind_is_floor == null) {
    return "How far behind the least-behind comparable feeder is is not established.";
  }
  return entry.min_behind_is_floor
    ? `Least-behind comparable feeder: at least ${entry.min_behind} behind — a lower bound.`
    : `Least-behind comparable feeder: exactly ${entry.min_behind} behind, as of a ref a comparable device had fetched within six hours of its reading — not the live tip.`;
}

/**
 * That the distance above is about a DIFFERENT DEVICE than the numbers are.
 *
 * `min_behind` is the roll-up's — the least-behind COMPARABLE feeder — while
 * every count came from `census_device_id`, which the backend picks by
 * freshest ref age, not by least behind (`_census_sort_key`). With more than
 * one device on a source those are routinely two different boxes, and two
 * figures side by side are read as being about one. The
 * `"Least-behind comparable feeder:"` prefix is doing that work alone, which
 * is too much weight for a prefix.
 *
 * `counts_are_floors` is the census device's OWN qualification, and it is the
 * one served field this panel would otherwise never render: `true` means that
 * device's distance counts are lower bounds. It qualifies the device the
 * stems came from, not the stem listings themselves — a truncated listing is
 * a separate rule that has already made the whole entry `unknown`.
 */
export function censusQualificationSentence(
  entry: PlanCoverage
): string | null {
  const parts: string[] = [];
  if (entry.device_count > 1 && entry.census_device_id) {
    parts.push(
      `The stems were enumerated by the device with the freshest ref, which ` +
        `among these ${entry.device_count} is not necessarily that feeder.`
    );
  }
  if (entry.counts_are_floors) {
    parts.push("That device's own distance counts are lower bounds.");
  }
  return parts.length ? parts.join(" ") : null;
}

/**
 * Which ref the authored side was enumerated at, and how old that fetch was.
 *
 * Two different shas can be in play and they are not interchangeable: the
 * census carries the sha its stems were LISTED at, while the reading carries
 * the ref sha the device REPORTED. They normally agree; when they do not, both
 * are shown, because a difference between them is exactly the kind of thing a
 * single rendered sha would hide.
 *
 * ⚠️ **The age belongs to the REPORTED ref, not to the listed one.**
 * `_census_side` copies `ref_age_secs` from the READING, not from the census
 * object. While the two shas agree that distinction is invisible, and in the
 * one branch this function exists to surface — they disagree — attaching the
 * age to the listed sha states an age nothing measured for it. So the age
 * moves onto whichever sha it is actually about.
 */
export function refSentence(
  entry: PlanCoverage,
  side: PlanCensusSide | null
): string | null {
  const listedAt = side?.ref_sha ?? null;
  const reported = entry.ref_sha;
  const sha = listedAt ?? reported;
  if (!sha) return null;
  const secs = side?.ref_age_secs ?? null;
  const disagree = Boolean(listedAt && reported && listedAt !== reported);

  if (disagree) {
    const age =
      secs == null
        ? "whose age was not measured"
        : `which was ${shortDuration(secs)} old at that reading`;
    return (
      `Differenced against ${listedAt}, whose own age at that reading was ` +
      `not reported. The reading itself reported ref ${reported}, ${age}.`
    );
  }

  const age =
    secs == null
      ? " Its age at that reading was not measured."
      : ` It was ${shortDuration(secs)} old at that reading.`;
  return `Differenced against ${sha}.${age}`;
}

/** Device ids, in full — a prefix can be shared, so it is never shortened. */
function DeviceIds({
  label,
  ids,
  testId,
}: {
  label: string;
  ids: string[];
  testId: string;
}) {
  if (ids.length === 0) return null;
  return (
    <p className="mt-1 text-[11px] text-muted-foreground" data-testid={testId}>
      {label}:{" "}
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 ? ", " : ""}
          <code className="break-all rounded bg-muted px-1 py-0.5 text-[10px]">
            {id}
          </code>
        </span>
      ))}
    </p>
  );
}

/**
 * The stems that exist and are not captured, behind a disclosure.
 *
 * Expandable rather than always-open because it is a list of up to
 * `COVERAGE_MISSING_SAMPLE_MAX` slugs under a panel whose job is three
 * numbers. The summary carries the count so the disclosure never hides the
 * FACT of the sample, only its contents — a collapsed section that hides its
 * own existence is how a signal gets lost.
 *
 * `sample_truncated` is stated inside, because a sample read as a complete
 * list is the same absence-is-not-zero error one level down: these stems are
 * missing, and the ones not shown are not therefore present.
 */
function MissingSample({ entry }: { entry: PlanCoverage }) {
  const key = coverageKey(entry.source_repo);
  if (entry.missing_sample.length === 0) return null;
  return (
    <details
      className="mt-2 rounded-md border border-border bg-background px-2.5 py-1.5"
      data-testid={`plan-coverage-sample:${key}`}
    >
      <summary className="cursor-pointer text-[11px] text-muted-foreground">
        {entry.sample_truncated
          ? `Show ${entry.missing_sample.length} of the missing stems`
          : `Show the ${entry.missing_sample.length} missing stem${entry.missing_sample.length === 1 ? "" : "s"}`}
      </summary>
      <ul className="mt-1.5 space-y-0.5">
        {entry.missing_sample.map((slug) => (
          <li key={slug}>
            <code className="break-all rounded bg-muted px-1 py-0.5 text-[10px]">
              {slug}
            </code>
          </li>
        ))}
      </ul>
      {entry.sample_truncated && (
        <p
          className="mt-1.5 text-[11px] text-muted-foreground"
          data-testid={`plan-coverage-sample-truncated:${key}`}
        >
          This is a sorted prefix of the missing stems, not all of them — a stem
          absent from this list is not therefore captured.
        </p>
      )}
    </details>
  );
}

/**
 * "heard 30s ago" / "silent 2m" — or neither, when freshness was not served.
 *
 * Three values, not two. `observation_fresh` is independently nullable on the
 * wire, and `!null` is `false`, so a two-valued read prints "silent" — an
 * assertion that the device went quiet — off a field that established
 * nothing. The age itself is still worth showing, so the third arm states the
 * age and withholds the verdict.
 */
export function ageLabel(entry: PlanCoverage): string | null {
  if (entry.observation_age_secs == null) return null;
  const age = shortDuration(entry.observation_age_secs);
  if (entry.observation_fresh == null) {
    return `reading ${age} old; freshness not established`;
  }
  return entry.observation_fresh ? `heard ${age} ago` : `silent ${age}`;
}

/**
 * One scan source's coverage.
 *
 * The count cluster is gated on TWO things, not one. `state === "measured"`
 * is necessary and not sufficient: every count on a `PlanCoverage` is
 * independently nullable, so a measured entry missing a census side would
 * otherwise render three integers with no denominator named anywhere on the
 * panel — the exact claim this feature deletes — or three `–` badges and no
 * sentence at all, which is the empty-panel shape one level down. So the
 * numbers appear only when [`denominatorSentence`] can name both sides, and
 * the shape that cannot says so in words.
 *
 * On `unknown` nothing is rendered as a count — not even a `–` badge beside a
 * sibling key's real integers, which is read at a glance as a small number —
 * and the "not established, because …" sentence takes its place. What
 * survives an `unknown` verdict is what does not come from the census: the
 * device identity, and the roll-up's distance.
 */
function CoverageEntryView({ entry }: { entry: PlanCoverage }) {
  const key = coverageKey(entry.source_repo);
  const id = (role: string) => `plan-coverage-${role}:${key}`;
  const denominators = denominatorSentence(entry);
  // A measured verdict whose denominators are unserved is neither arm the
  // backend documents, so it gets its own: no counts, and a sentence.
  const measured = entry.state === "measured" && denominators != null;
  const denominatorsUnserved = entry.state === "measured" && !denominators;
  const missing = missingSentence(entry);
  const extra = capturedNotAuthoredSentence(entry);
  const outOfScope = outOfScopeSentence(entry);
  const ref = refSentence(entry, entry.authored_at_ref);
  const qualification = censusQualificationSentence(entry);
  const age = ageLabel(entry);

  return (
    <div
      className="border-t border-border/60 px-3 py-2.5 text-xs first:border-t-0"
      data-testid={id("entry")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={entry.state === "measured" ? "outline" : "warning"}
          className="shrink-0"
          data-testid={id("state")}
        >
          {coverageStateLabel(entry.state)}
        </Badge>
        <span className="min-w-0 break-all text-muted-foreground">
          {entry.source_repo ?? "scan source not named"}
        </span>
        {age && (
          <span
            className="ml-auto shrink-0 text-muted-foreground"
            data-testid={id("age")}
          >
            {age}
          </span>
        )}
      </div>

      {measured ? (
        <>
          <StatCluster
            className="mt-2 flex flex-wrap items-center gap-2"
            data-testid={id("counts")}
            stats={[
              {
                key: "both",
                label: "At the ref and captured ",
                value: entry.both,
                tone: "success",
                title:
                  "Stems that exist at the default ref AND have a row in the corpus under this scan source.",
                "data-testid": id("both"),
              },
              {
                key: "missing",
                label: "At the ref, not captured ",
                value: entry.authored_not_captured,
                tone: entry.authored_not_captured ? "warning" : "muted",
                title:
                  "Stems that exist at the default ref with no row in the corpus under this scan source.",
                "data-testid": id("missing"),
              },
              {
                key: "extra",
                label: "Captured, not at the ref ",
                value: entry.captured_not_authored,
                tone: "muted",
                title:
                  "Rows the corpus holds under this scan source whose stem is not at the default ref. Not a coverage defect.",
                "data-testid": id("extra"),
              },
            ]}
          />

          {denominators && (
            <p
              className="mt-2 text-[11px] text-muted-foreground"
              data-testid={id("denominators")}
            >
              {denominators}
            </p>
          )}

          {missing && (
            <p
              className="mt-1 text-[11px] text-muted-foreground"
              data-testid={id("missing-sentence")}
            >
              {missing}
            </p>
          )}

          {extra && (
            <p
              className="mt-1 text-[11px] text-muted-foreground"
              data-testid={id("extra-sentence")}
            >
              {extra}
            </p>
          )}

          {outOfScope && (
            <p
              className="mt-1 text-[11px] text-muted-foreground"
              data-testid={id("out-of-scope")}
            >
              {outOfScope}
            </p>
          )}

          <MissingSample entry={entry} />
        </>
      ) : denominatorsUnserved ? (
        <p
          className="mt-2 text-[11px] text-amber-700 dark:text-amber-300"
          data-testid={id("denominators-unserved")}
        >
          This scan source reports a measured verdict, but the response carries
          no stem listing for one or both sides — so the counts have no
          denominator to be read against and none of them is shown. That is not
          0 captured and not full coverage.
        </p>
      ) : (
        <p
          className="mt-2 text-[11px] text-amber-700 dark:text-amber-300"
          data-testid={id("not-established")}
        >
          {notEstablishedSentence(entry)}
          {entry.detail && splitDetail(entry.detail).reason ? (
            <>
              {" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                {splitDetail(entry.detail).reason}
              </code>
            </>
          ) : null}
        </p>
      )}

      <p
        className="mt-1 text-[11px] text-muted-foreground"
        data-testid={id("distance")}
      >
        {distanceSentence(entry)}
        {ref ? ` ${ref}` : ""}
        {qualification ? ` ${qualification}` : ""}
      </p>

      {entry.census_device_id && (
        <DeviceIds
          label="Census device"
          ids={[entry.census_device_id]}
          testId={id("census-device")}
        />
      )}
      <DeviceIds
        label="Other devices with a usable census (they may disagree)"
        ids={entry.other_census_device_ids}
        testId={id("other-devices")}
      />
    </div>
  );
}

/**
 * "Read at …" — the moment every age on this panel was measured.
 *
 * Every age here is a SERVER-COMPUTED DELTA frozen when the request left
 * (`observation_age_secs`, `ref_age_secs`), and this panel does not poll, so
 * without a stamp a console left open overnight keeps reading "heard 30s ago"
 * — a stale reading rendered as current, which is the defect this whole
 * feature exists to remove, reappearing at the panel instead of the row.
 *
 * It is also what the second GET of `/scan-roots` was paid for:
 * `usePlanCoverage` keeps its own read precisely so this stamp belongs to
 * THESE numbers and not to the ones in the panel above.
 *
 * The DATE appears whenever the read was not today. A bare
 * `toLocaleTimeString` cannot express the overnight case, which is the one
 * case the stamp exists for.
 */
function ReadAt({ at }: { at: Date | null }) {
  if (!at) return null;
  const today = new Date().toDateString() === at.toDateString();
  return (
    <span data-testid="plan-coverage-read-at">
      {" "}
      Read at {today ? at.toLocaleTimeString() : at.toLocaleString()}; the ages
      above are as of then.
    </span>
  );
}

/**
 * The coverage set difference, per scan source.
 *
 * Sits directly beneath `Scan sources`, whose question it completes: that
 * panel says how far behind the tree each feeder scans is, and this says what
 * that distance COST the corpus — which stems exist and are not held.
 *
 * Five absences it refuses to render as full coverage, each mirroring a
 * backend rule:
 *
 * * **An empty — or absent — `coverage`** is `coverage_detail`'s sentence,
 *   never an empty panel. Three different reasons produce an empty one and
 *   only one of them is about this organization's data at all; an ABSENT one
 *   is a backend predating Phase 3, and it lands in the same branch with no
 *   detail to quote, where the fallback sentence says UNKNOWN.
 * * **An `unknown` entry** is a "not established, because …" sentence, never
 *   a zero. Its numbers are `null` and the panel prints none of them.
 * * **A measured entry with no census side served** prints no counts either:
 *   integers with no denominator anywhere are the claim this panel exists to
 *   delete.
 * * **A failed read** leaves the previous entries on screen, says they may be
 *   stale, and does not blank them into a false zero.
 * * **No percentage anywhere but beside both denominators**, for the reason
 *   the module docstring gives at length.
 *
 * And every age is stamped with the moment it was read, because none of them
 * is recomputed after the response lands.
 */
export function PlanCoveragePanel() {
  const { data, fetchedAt, loading, error, reload } = usePlanCoverage();
  // `?? []` is not a default value here — it is the pre-Phase-3 backend and
  // the front/back deploy skew, where the field is absent rather than empty.
  // Both land in the same branch below, and `coverage_detail` is absent there
  // too, so the branch's own fallback sentence says UNKNOWN rather than
  // inventing a reason. Reading `.length` off `undefined` would instead throw
  // and take down the whole route segment.
  const entries = data?.coverage ?? [];

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="plan-coverage"
    >
      <div className="flex items-start gap-3">
        <Layers className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Plan coverage</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            What the corpus holds against what exists, per scan source — a set
            difference, not a ratio. There are two denominators here and they
            answer different questions, so every count names the side it is
            taken over.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 shrink-0 px-2 text-xs"
          onClick={() => reload()}
          disabled={loading}
          data-testid="plan-coverage-refresh"
        >
          <RefreshCw className="size-3" aria-hidden />
          Refresh
        </Button>
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="plan-coverage-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t read plan coverage: {error}.{" "}
            {data
              ? "The numbers below are the last ones read and may be stale."
              : "Nothing could be read — how much of what exists the corpus holds is unknown, not full."}
          </p>
        </div>
      )}

      {loading && !data ? (
        <Skeleton
          className="mt-4 h-20 w-full"
          data-testid="plan-coverage-loading"
        />
      ) : data == null ? null : entries.length === 0 ? (
        <p
          className="mt-3 text-xs text-muted-foreground"
          data-testid="plan-coverage-none"
        >
          {data.coverage_detail ??
            "No coverage was served and no reason was given, so how much of what exists the corpus holds is not established. An empty answer is not “nothing is missing”."}
          <ReadAt at={fetchedAt} />
        </p>
      ) : (
        <>
          <div
            className="mt-3 overflow-hidden rounded-md border border-border bg-background"
            data-testid="plan-coverage-entries"
          >
            {entries.map((entry) => (
              <CoverageEntryView
                key={coverageKey(entry.source_repo)}
                entry={entry}
              />
            ))}
          </div>
          <p
            className="mt-2 text-[11px] text-muted-foreground"
            data-testid="plan-coverage-summary"
          >
            {/* Not "differenced": an `unknown` entry is listed and was NOT
                differenced, so a summary claiming otherwise would assert the
                measurement the entry below it refuses to make. */}
            {plural(entries.length, "scan source")} in this reading.
            <ReadAt at={fetchedAt} />
          </p>
        </>
      )}
    </section>
  );
}
