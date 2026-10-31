"use client";

/**
 * The six regions of `/admin/coord/home`, top to bottom — plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4:
 *
 *   1. the strip — one derived headline, never green over a block not read;
 *   2. Needs you — operator forks, each as fork + recommendation; until coord
 *      serves that block, the Gates and Questions lists' counts;
 *   3. Degrading — open degradations with their onset, recently cleared
 *      folded, and the machine roster in coord's project-state terms
 *      (degrading, no verdict, and what the nav counts that is neither);
 *   4. Work by state — class totals, then one row per repo expanding to its
 *      class counts and named units;
 *   5. Correct? — present from day one so its absence is visible (to the
 *      operator; a presentation leaves it out while nothing measures it);
 *   6. What this view does not know — always rendered: the sources not read
 *      listed, the ones read behind one disclosure.
 *
 * Composition only (style guide §6.4): every visual element here is a console
 * primitive. Every derivation — the strip, the labels, the "may we say nothing
 * needs you" predicate — lives in `coordHomeStatus.ts`, which is unit-tested;
 * nothing below decides a colour or a word on its own (R8).
 *
 * ## Presentation mode (plan `2026-10-23-console-presentation-spaces` Phase 2)
 *
 * The same regions over the same read, rendered for an external evaluator
 * (style guide §3.14): each region opens with its caption and the provenance
 * of its figures (`RegionCaption`); every free-text carrier renders through
 * `RedactedText` / `useRedactor` with a structured descriptor
 * (`_lib/homeLens.ts`), and every value read against one of the page's
 * tables — a decision kind, a does-not-know source, a degradation's area —
 * shows only when the table names it, in fixed words otherwise; a machine is
 * its alias
 * (`useMachineAliaser`); R8's raw last line and coord's quoted error chains
 * are not rendered; a row is keyed by an alias of its operator key
 * (`useRowKey`); a link goes through `LensLink`, and a drill or an
 * instruction whose page cannot be presented is left out (`useLinkOpens`);
 * and answering a decision is `OperatorOnly`. In operator mode every one of
 * those renders the original, so #1999's page is unchanged.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  CollapsiblePanel,
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatCluster,
  StatusBadge,
  absoluteTime,
  relativeTime,
  staleDetail,
  type Stat,
} from "@/components/console";
import {
  LensLink,
  OperatorOnly,
  RedactedText,
  redactionVerdict,
  usePresentationMode,
  usePresentationScopeState,
  useRedactor,
} from "@/components/presentation";
import { FAILURE_SENTENCE_WITHHELD } from "@/components/operations/presentedFailure";
import {
  BLOCKED_UNIT_DESCRIPTOR,
  INITIATIVE_UNPARSEABLE_SENTENCE,
  RepositoryAliases,
  repositoryAliasDescriptor,
  INITIATIVE_ITEM_DESCRIPTOR,
  INITIATIVE_KEYS_DESCRIPTOR,
  REPOSITORY_DESCRIPTOR,
  TENANT_DESCRIPTOR,
  degradationDescriptor,
  degradationRepo,
  namedUnitDescriptor,
  namedUnitRepos,
  needsDescriptor,
  needsStatusWord,
  presentedDecisionDomains,
  presentedInitiativeDate,
  presentedInitiativeStatus,
  presentedPlanPhase,
  presentedSourceLabel,
  reasonDescriptor,
  type DegradationRowKind,
  type NamedListKind,
} from "../_lib/homeLens";
import {
  HomeRefreshButton,
  RegionCaption,
  useLinkOpens,
  usePlaneLabel,
  usePlaneWords,
  useRowKey,
  useSubjectText,
} from "./HomeLens";
import {
  degradingCoverage,
  isRosterBindingFault,
  notDegradationsSentence,
} from "@/components/admin/coord/machineHealth";
import {
  GATES_SOURCE,
  MACHINES_SOURCE,
  QUESTIONS_SOURCE,
  machineHealthSentence,
  machinesAllHealthy,
  queueCountText,
  supplementSource,
  type MachineHealthView,
  type QueueCount,
} from "../_lib/homeSupplements";
import {
  BLOCK_STATE_PHRASE,
  HOME_ATTENTION_BY_KIND,
  HOME_STATUS_PALETTE,
  UNIT_CLASSES,
  boundText,
  correctnessHasNoSource,
  degradationRawLine,
  degradationsGapPhrase,
  degradationsGapTitle,
  durationText,
  needsYouReason,
  needsDisplayCount,
  nothingNeedsYou,
  lastGoodReadPhrase,
  namedUnitAgePhrase,
  openDegradations,
  planeFreshnessPhrase,
  planeWatcherNames,
  attributedText,
  initiativeAttributionPhrase,
  decisionDomainLabel,
  isKnownPlane,
  withoutVerdictWords,
  remediationPhrase,
  sourceErrorSentence,
  sourceLabel,
  sourceRawLine,
  sourceRowReason,
  unstatedSummary,
  sourceTimeWords,
  stallWindowDays,
  unitClassLabel,
  unservedDecisionsSentence,
  internalHref,
  isWatcherSource,
  windowLabel,
  type BlockState,
  type CorrectnessView,
  type DegradationView,
  type DegradationsView,
  type HomeRowKind,
  type HomeStrip,
  type NamedList,
  type NamedUnit,
  type NeedsMeItem,
  type NeedsMeView,
  type OnTrackView,
  type PlaneView,
  type RepoGroup,
  type SourceCoverageView,
  unitCountText,
  groupBreakdown,
  groupBreakdownSentence,
  unnamedUnitsSentence,
} from "@/components/admin/coord/coordHomeStatus";

const HEADING =
  "text-sm font-semibold text-muted-foreground uppercase tracking-wider";

function HomeBadge({ kind, label }: { kind: HomeRowKind; label: string }) {
  return (
    <StatusBadge
      status={{ kind, label, attention: HOME_ATTENTION_BY_KIND[kind] }}
      palette={HOME_STATUS_PALETTE}
    />
  );
}

/**
 * The sentence a block renders in place of its content when it is not read.
 *
 * `unknown` stands for three different cases, which the parser folds into one
 * state: coord's own `unknown`, a block absent from coord's body, and a
 * state string this page does not recognise. Its sentence must be true of all
 * three, so it claims only what they share: coord gave no reading.
 */
export function notReadSentence(what: string, state: BlockState): string {
  switch (state) {
    case "not_implemented":
      return `Not known — coord does not serve ${what} on this view yet.`;
    case "could_not_read":
      return `Not known — coord could not read ${what} this time; nothing here is a zero.`;
    case "stale":
      return `Incomplete — coord could only partly read ${what}.`;
    case "unknown":
    case "read":
      return `Not known — coord gave no reading of ${what}.`;
  }
}

function NotRead({
  what,
  state,
  testId,
  error = null,
  children,
}: {
  what: string;
  state: BlockState;
  testId: string;
  /**
   * The block's `error`: coord's error chain, which run_sub_read also puts in
   * the matching does-not-know row.
   */
  error?: string | null;
  children?: ReactNode;
}) {
  const { presenting } = usePresentationMode();
  const reported = error !== null && error.trim() !== "";
  return (
    <div
      className="text-sm text-muted-foreground space-y-1"
      data-testid={testId}
      data-block-state={state}
    >
      <p className="m-0">{notReadSentence(what, state)}</p>
      {children}
      {reported && presenting && (
        // The block still says it was not read, and that coord said why; the
        // chain itself can name a table, a host or a repository, so while
        // presenting it is not quoted (D3.3, `presentedFailure.ts`).
        <p className="m-0 text-xs" data-testid={`${testId}.error-withheld`}>
          Coord reported an error. {FAILURE_SENTENCE_WITHHELD}
        </p>
      )}
      {reported && !presenting && (
        // R8, as the does-not-know row words the same chain: an `anyhow`
        // context ("SELECT coord.work_units (…): …") is internal vocabulary,
        // so the block says coord reported an error and quotes the chain one
        // disclosure down, on a raw last line.
        <details className="text-xs" data-testid={`${testId}.error`}>
          <summary className="cursor-pointer">Coord reported an error</summary>
          <p
            className="m-0 mt-1 font-mono text-[10px] text-muted-foreground/60 break-all"
            data-testid={`${testId}.error.raw`}
          >
            {withoutVerdictWords(error)}
          </p>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. The strip
// ---------------------------------------------------------------------------

export function HomeStripSection({
  strip,
  tenantName,
  tenantId,
  stale,
  generatedAt,
  failure,
  onRefresh,
}: {
  strip: HomeStrip;
  tenantName: string | null;
  tenantId: string | null;
  stale: boolean;
  generatedAt: string | null;
  /**
   * Why the latest read failed, as this mode may show it (`page.tsx`,
   * `presentedHomeFailure`): the read's own words for the operator; while
   * presenting, the page's fixed words or the withheld reason — never a URL
   * or coord's body.
   */
  failure: string | null;
  onRefresh: () => Promise<void>;
}) {
  const { presenting } = usePresentationMode();
  // R8: the tenant's UUID is a raw id, so it is the title, never the text —
  // and while presenting it is not even the title (D3.3: no raw id). The name
  // belongs to no repository a scope can vouch for, so it is withheld then.
  const tenant = tenantId ? (
    <>
      Tenant:{" "}
      {tenantName === null ? (
        "not in your project list"
      ) : (
        <RedactedText
          text={tenantName}
          repo={null}
          descriptor={TENANT_DESCRIPTOR}
        />
      )}
    </>
  ) : (
    "Tenant: not stated by coord"
  );
  const age = generatedAt
    ? `Showing coord's answer from ${relativeTime(generatedAt)} (${absoluteTime(generatedAt)}).`
    : "";
  const lead = [
    stale ? staleDetail(age) : null,
    stale && failure ? `Last failure: ${failure}.` : null,
    strip.detail,
  ]
    .filter(Boolean)
    .join(" ");
  const detail = (
    <>
      {lead ? `${lead} ` : ""}
      <span
        title={presenting ? undefined : (tenantId ?? undefined)}
        data-testid="coord-home.strip.tenant"
      >
        {tenant}
      </span>
    </>
  );
  return (
    <>
      <RegionCaption region="strip" reading={{ generatedAt, kept: stale }} />
      <section
        className="flex items-center gap-2"
        data-ui-bridge-id="coord-home.strip"
        data-testid="coord-home.strip"
        data-stale={stale ? "true" : undefined}
      >
        <HealthStrip
          className="flex-1 min-w-0"
          level={strip.level}
          headline={strip.headline}
          detail={detail}
          badges={strip.badges.map((b) => ({
            key: b.key,
            label: b.label,
            tone: b.tone,
            "data-testid": b.testId,
          }))}
          data-testid="coord-home.strip.health"
        />
        <HomeRefreshButton onRefresh={onRefresh} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Needs you
// ---------------------------------------------------------------------------

function NeedsYouRow({
  item,
  expanded,
  onToggle,
}: {
  item: NeedsMeItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { presenting } = usePresentationMode();
  const redact = useRedactor();
  const answerHref = internalHref(item.answerAt);
  // Every text of the item is the asking agent's own, and belongs to no
  // repository a scope can vouch for: verbatim for the operator, its
  // descriptor while presenting (D3.3).
  const descriptor = needsDescriptor(item);
  const blocking = item.blocking;
  return (
    <RecordRow
      identity={item.source === "operator_gate" ? "gate" : "question"}
      label={
        item.fork === null ? (
          <span>(no question text)</span>
        ) : (
          <span title={redact({ text: item.fork, repo: null, descriptor })}>
            <RedactedText
              text={item.fork}
              repo={null}
              descriptor={descriptor}
            />
          </span>
        )
      }
      status={<HomeBadge kind="needs_you" label={needsStatusWord(item)} />}
      reason={
        item.recommendation === null
          ? needsYouReason(item)
          : redact({
              text: item.recommendation,
              repo: null,
              descriptor: needsDescriptor(item, "Recommendation"),
            })
      }
      time={<RowTime at={item.askedAt} verb="Asked" />}
      attention={HOME_ATTENTION_BY_KIND.needs_you}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-home.needs-you.row"
    >
      <RecordDetail
        why={
          <div className="space-y-1">
            <p className="m-0">
              <span className="text-muted-foreground">Recommended: </span>
              {/* The detail states the recommendation plainly; the row's
                  collapsed reason (needsYouReason) carries the label. */}
              {item.recommendation === null ? (
                "none given"
              ) : (
                <RedactedText
                  text={item.recommendation}
                  repo={null}
                  descriptor={needsDescriptor(item, "Recommendation")}
                />
              )}
            </p>
            <p className="m-0">
              <span className="text-muted-foreground">
                If you overturn it:{" "}
              </span>
              {item.ifOverturned === null ? (
                "not stated"
              ) : (
                <RedactedText
                  text={item.ifOverturned}
                  repo={null}
                  descriptor={needsDescriptor(item, "Consequence")}
                />
              )}
            </p>
            {item.options === null ? (
              <p className="m-0 text-muted-foreground">Options: not readable</p>
            ) : (
              item.options.length > 0 && (
                <p className="m-0 text-muted-foreground">
                  Options:{" "}
                  <RedactedText
                    text={item.options.join(" · ")}
                    repo={null}
                    descriptor={needsDescriptor(item, "Options")}
                  />
                </p>
              )
            )}
            {blocking && (blocking.workUnitSlug || blocking.planPhase) && (
              <p className="m-0 text-muted-foreground">
                Blocks:{" "}
                {!blocking.workUnitSlug ? (
                  "a piece of work"
                ) : presenting ? (
                  // Its URL would carry the slug the descriptor withholds,
                  // so a withheld unit is never linked.
                  <RedactedText
                    text={blocking.workUnitSlug}
                    repo={null}
                    descriptor={BLOCKED_UNIT_DESCRIPTOR}
                  />
                ) : (
                  <LensLink
                    href={`/admin/coord/work-units/${encodeURIComponent(blocking.workUnitSlug)}`}
                    className="underline underline-offset-2"
                  >
                    {blocking.workUnitSlug}
                  </LensLink>
                )}
                {blocking.planPhase
                  ? `, phase ${presenting ? presentedPlanPhase(blocking.planPhase) : blocking.planPhase}`
                  : ""}
              </p>
            )}
          </div>
        }
        actions={
          // Answering is the operator's write, on another page: an evaluator
          // does not act (D3.2), so neither the link nor its absence shows.
          <OperatorOnly>
            {answerHref ? (
              <LensLink
                href={answerHref}
                className="text-sm underline underline-offset-2"
                data-testid="coord-home.needs-you.answer"
              >
                Answer it ↗
              </LensLink>
            ) : (
              <p className="m-0 text-muted-foreground">
                Coord served no page to answer this on.
              </p>
            )}
          </OperatorOnly>
        }
        raw={
          // R8's raw last line — the gate or question id — is the operator's:
          // not rendered at all while presenting (D3.3: no raw id).
          presenting ? undefined : (
            <span className="font-mono text-[10px] text-muted-foreground/60 break-all">
              {item.source ?? "source unknown"} · {item.id}
            </span>
          )
        }
      />
    </RecordRow>
  );
}

/** One queue count's line: the figure, why it is unknown, and its page. */
function QueueCountLine({
  label,
  what,
  q,
  href,
  page,
  testId,
}: {
  label: string;
  /** The list, for the unknown sentence: "the gates list". */
  what: string;
  q: QueueCount;
  href: string;
  page: string;
  testId: string;
}) {
  const opens = useLinkOpens();
  const text = queueCountText(q);
  const why =
    q.state === "read"
      ? q.stale
        ? " (at its last good read)"
        : ""
      : q.state === "could_not_read"
        ? ` — ${what} could not be read`
        : ` — ${what} has not been read yet`;
  // `what` names a list, never a page: "the gates list", "the questions list".
  return (
    <li data-testid={testId} data-count-state={q.state}>
      {label}: <span className="tabular-nums text-foreground">{text}</span>
      {why}
      {/* While presenting, a page that cannot be presented is a dead end,
          so its link is left out (`useLinkOpens`). */}
      {opens(href) && (
        <>
          {" · "}
          <LensLink href={href} className="underline">
            {page}
          </LensLink>
        </>
      )}
    </li>
  );
}

/**
 * What waits on the operator, counted from the Gates and Questions pages'
 * reads until coord serves its `needs_me` block. Each count is the page's own
 * source and links there; an unread source says UNKNOWN and why, never 0.
 */
function QueueCounts({
  gates,
  questions,
}: {
  gates: QueueCount;
  questions: QueueCount;
}) {
  // While presenting, the Gates and Questions pages cannot be shown, so the
  // lines name what is counted, not the pages that list it.
  const { presenting } = usePresentationMode();
  return (
    <div className="space-y-1" data-testid="coord-home.needs-you.counts">
      <p className="m-0">
        {presenting
          ? "Counted from coord's lists of open approvals and pending agent questions:"
          : "Meanwhile, counted from the lists the Gates and Questions pages read:"}
      </p>
      <ul className="m-0 pl-4 list-disc space-y-0.5">
        <QueueCountLine
          label={
            presenting
              ? "Approvals waiting on the operator"
              : "Approvals waiting on you"
          }
          what="the gates list"
          q={gates}
          href="/admin/coord/gates"
          page="Gates"
          testId="coord-home.needs-you.count.gates"
        />
        <QueueCountLine
          label={
            presenting
              ? "Agent questions waiting on the operator"
              : "Questions waiting on you"
          }
          what="the questions list"
          q={questions}
          href="/admin/coord/questions"
          page="Questions"
          testId="coord-home.needs-you.count.questions"
        />
      </ul>
    </div>
  );
}

export function NeedsYouSection({
  needs,
  gates,
  questions,
  stale = false,
  generatedAt = null,
}: {
  needs: NeedsMeView;
  /**
   * Open operator approvals and pending operator questions, read from the
   * Gates and Questions pages' own sources (`_lib/homeSupplements.ts`) —
   * shown while coord's `needs_me` block is not read.
   */
  gates: QueueCount;
  questions: QueueCount;
  /** The latest poll failed; this is the last good read (style guide R6). */
  stale?: boolean;
  generatedAt?: string | null;
}) {
  const { presenting } = usePresentationMode();
  const rowKey = useRowKey();
  const opens = useLinkOpens();
  const read = needs.state === "read";
  const served = needs.items?.length ?? 0;
  // One displayable count, shared with the strip: never "1 shown of 0".
  const count = needsDisplayCount(needs);
  const header = read
    ? `${served} shown of ${count ?? "an unknown number"}${
        needs.omitted !== null && needs.omitted > 0
          ? ` · ${needs.omitted} not shown`
          : ""
      }`
    : BLOCK_STATE_PHRASE[needs.state];
  // While presenting, a block coord has not built is left out: the counts
  // read from the Gates and Questions lists stand in for it, unlabelled by
  // "not built yet".
  const unbuiltWhilePresenting =
    presenting && needs.state === "not_implemented";
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.needs-you"
      data-testid="coord-home.needs-you"
      data-block-state={needs.state}
    >
      <RegionCaption
        region="needs-you"
        reading={{ generatedAt, kept: stale }}
        extraSources={
          read
            ? []
            : [
                supplementSource(GATES_SOURCE, gates),
                supplementSource(QUESTIONS_SOURCE, questions),
              ]
        }
      />
      <div className="flex items-baseline gap-2">
        <h2 className={HEADING}>Needs you</h2>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="coord-home.needs-you.count"
        >
          {unbuiltWhilePresenting ? null : header}
        </span>
      </div>
      {read && needs.byDomain && Object.keys(needs.byDomain).length > 0 && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-home.needs-you.by-domain"
        >
          By kind of decision:{" "}
          {(presenting
            ? // A key the table does not name can be a substring of a
              // question's text: fixed words while presenting (D3.3).
              presentedDecisionDomains(needs.byDomain)
            : Object.entries(needs.byDomain).map(
                ([domain, n]) => `${decisionDomainLabel(domain)} ${n}`
              )
          ).join(" · ")}
        </p>
      )}
      {read && needs.retirement === "unsupported" && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-home.needs-you.retirement"
          data-retirement="unsupported"
        >
          This list may contain questions whose condition has already resolved:
          coord cannot retire them on this database.
        </p>
      )}
      {read && needs.retirement === "unknown" && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-home.needs-you.retirement"
          data-retirement="unknown"
        >
          Whether withdrawn questions are filtered out is not known yet, so this
          list may contain questions whose condition has already resolved.
        </p>
      )}
      {read ? (
        nothingNeedsYou(needs) ? (
          <p className="m-0 text-sm" data-testid="coord-home.needs-you.empty">
            {stale
              ? `Nothing needed you ${lastGoodReadPhrase(generatedAt)}`
              : "Nothing needs you"}
          </p>
        ) : served === 0 ? (
          <p
            className="m-0 text-sm text-muted-foreground"
            data-testid="coord-home.needs-you.unserved"
          >
            {unservedDecisionsSentence(count)}
            {opens("/admin/coord/questions") ? (
              <>
                ; open{" "}
                <LensLink href="/admin/coord/questions" className="underline">
                  Questions
                </LensLink>
                .
              </>
            ) : (
              // While presenting, an instruction to open a page the
              // presentation cannot show is a dead end: the sentence ends.
              "."
            )}
          </p>
        ) : (
          <RecordList
            items={needs.items ?? []}
            itemKey={(i, idx) =>
              rowKey("needs", `${i.source ?? "item"}:${i.id}:${idx}`)
            }
            renderRow={(item, ctx) => (
              <NeedsYouRow
                item={item}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
          />
        )
      ) : unbuiltWhilePresenting ? (
        <div className="text-sm text-muted-foreground">
          <QueueCounts gates={gates} questions={questions} />
        </div>
      ) : (
        <NotRead
          what="the decisions waiting on you"
          state={needs.state}
          testId="coord-home.needs-you.not-read"
        >
          <QueueCounts gates={gates} questions={questions} />
        </NotRead>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Degrading
// ---------------------------------------------------------------------------

function DegradationRow({
  d,
  kind,
  expanded,
  onToggle,
}: {
  d: DegradationView;
  kind: DegradationRowKind;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { presenting } = usePresentationMode();
  const redact = useRedactor();
  const subjectText = useSubjectText();
  const opens = useLinkOpens();
  const planeName = usePlaneLabel();
  // Evidence one click down — and only where the click opens something:
  // while presenting, a drill to a page the presentation cannot show would
  // be link-shaped text that opens nothing, so it is left out.
  const drillHref = internalHref(d.drill);
  const drill = drillHref !== null && opens(drillHref) ? drillHref : null;
  const label =
    kind === "cleared"
      ? "cleared"
      : kind === "declared"
        ? "declared"
        : "degrading";
  // The headline is coord's sentence, attributed to the repository its
  // subject names, if any (D3.3): a machine's or a service's is withheld
  // while presenting, a first-party repository's shows.
  const headlineRepo = degradationRepo(d);
  const descriptor = degradationDescriptor(d, kind);
  const time =
    kind === "cleared" ? (
      <RowTime at={d.resolvedAt} verb="Cleared" />
    ) : (
      <RowTime
        at={d.onsetObservedAt}
        verb="First seen by coord"
        prefix={`since ${absoluteTime(d.onsetObservedAt)} · `}
      />
    );
  return (
    <RecordRow
      identity={planeName(d.plane)}
      label={
        d.headline === null ? (
          <span>(no headline)</span>
        ) : (
          <span
            title={redact({ text: d.headline, repo: headlineRepo, descriptor })}
          >
            <RedactedText
              text={d.headline}
              repo={headlineRepo}
              descriptor={descriptor}
            />
          </span>
        )
      }
      status={<HomeBadge kind={kind} label={label} />}
      reason={subjectText(d, kind)}
      time={time}
      attention={HOME_ATTENTION_BY_KIND[kind]}
      expanded={expanded}
      onToggle={onToggle}
      data-testid={`coord-home.degrading.${kind}`}
    >
      <RecordDetail
        why={
          <div className="space-y-1">
            <p className="m-0">{remediationPhrase(d)}.</p>
            <p className="m-0 text-muted-foreground">
              Onset is when coord first observed it (
              {absoluteTime(d.onsetObservedAt)}), not necessarily when it began.
              {kind === "cleared"
                ? ` Lasted ${durationText(d.durationSecs)}.`
                : ` Open for ${durationText(d.ageSecs)}; last seen ${relativeTime(d.lastSeenAt)}.`}
            </p>
          </div>
        }
        actions={
          drill ? (
            // While presenting it carries the presentation (`LensLink`).
            <LensLink
              href={drill}
              className="text-sm underline underline-offset-2"
            >
              Open {drill.replace("/admin/coord/", "")} ↗
            </LensLink>
          ) : undefined
        }
        raw={
          // R8's raw last line — the row id, the subject's device id — is
          // the operator's: not rendered at all while presenting (D3.3).
          presenting ? undefined : (
            <span
              className="font-mono text-[10px] text-muted-foreground/60 break-all"
              data-testid="coord-home.degrading.raw"
            >
              {degradationRawLine(d)}
            </span>
          )
        }
      />
    </RecordRow>
  );
}

/**
 * The machines line under the degradations, in coord's project-state terms:
 * how many machines are degrading and whether coord's list above already
 * shows them (`listed`; null when no list was served), how many have no
 * verdict — and, so this section reconciles with the `Dev Ops ▾` badge, the
 * machines that badge counts as not healthy that are not degradations
 * (abandoned, no verdict), by state. Counts only, never a machine's name; the
 * machines themselves are on Dev Ops, linked where that page opens.
 */
function MachineHealthLine({
  machines,
  listed,
}: {
  machines: MachineHealthView;
  listed: number | null;
}) {
  const opens = useLinkOpens();
  const { presenting } = usePresentationMode();
  const read = machines.state === "read" && machines.counts !== null;
  const devOps = read && opens("/admin/coord/devops");
  const fault =
    machines.emptyRoster !== null && isRosterBindingFault(machines.emptyRoster);
  const reconcile =
    read && machines.counts !== null
      ? notDegradationsSentence(machines.counts, { seeDevOps: false })
      : null;
  return (
    <>
      <p
        className="m-0 text-sm"
        data-testid="coord-home.degrading.machines"
        data-ui-bridge-id="coord-home.degrading.machines"
        data-machines-state={machines.state}
        data-roster-fault={fault ? "true" : undefined}
      >
        <span className="text-muted-foreground">Machines: </span>
        {read && machines.stale ? "At the last good read, " : ""}
        {/* Coord's own error text is the operator's alone (R8). */}
        {machineHealthSentence(machines, { listed, withReason: !presenting })}
        {devOps && !reconcile && (
          <>
            {" "}
            <LensLink href="/admin/coord/devops" className="underline">
              See them on Dev Ops
            </LensLink>
            .
          </>
        )}
      </p>
      {reconcile && (
        <p
          className="m-0 text-sm text-muted-foreground"
          data-testid="coord-home.degrading.machines-reconcile"
        >
          {/* The sentence's own full stop moves after the link. */}
          {reconcile.replace(/\.$/, "")}
          {devOps && (
            <>
              {" — see "}
              <LensLink href="/admin/coord/devops" className="underline">
                Dev Ops
              </LensLink>
            </>
          )}
          .
        </p>
      )}
    </>
  );
}

export function DegradingSection({
  deg,
  machines,
  sources = null,
  stale = false,
  generatedAt = null,
}: {
  deg: DegradationsView;
  /**
   * Coord's machine roster, read beside the project state
   * (`_lib/homeSupplements.ts`). Coord's project state already lists a
   * degrading machine as a row; the roster says which machines have no
   * verdict, which the nav counts that are not degradations, and any
   * degrading machine the list does not show.
   */
  machines: MachineHealthView;
  /**
   * What the view does not know (`does_not_know`): the gap sentence names the
   * degradation sources coord did not fully read from it.
   */
  sources?: SourceCoverageView[] | null;
  /** The latest poll failed; this is the last good read (style guide R6). */
  stale?: boolean;
  generatedAt?: string | null;
}) {
  const { presenting } = usePresentationMode();
  const rowKey = useRowKey();
  const planeName = usePlaneLabel();
  const planeWords = usePlaneWords();
  const open = openDegradations(deg);
  const declared = [
    ...(deg.open ?? []).filter((r) => r.declared),
    ...(deg.declared ?? []),
  ];
  const cleared = deg.recentlyCleared ?? [];
  const rowsServed = deg.state === "read" || deg.state === "stale";
  const rows: { d: DegradationView; kind: "degrading" | "declared" }[] = [
    ...(open ?? []).map((d) => ({ d, kind: "degrading" as const })),
    ...declared.map((d) => ({ d, kind: "declared" as const })),
  ];
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.degrading"
      data-testid="coord-home.degrading"
      data-block-state={deg.state}
    >
      <RegionCaption
        region="degrading"
        reading={{ generatedAt, kept: stale }}
        extraSources={[supplementSource(MACHINES_SOURCE, machines)]}
      />
      <div className="flex items-baseline gap-2">
        <h2 className={HEADING}>Degrading</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {deg.state !== "read"
            ? BLOCK_STATE_PHRASE[deg.state]
            : open === null
              ? "– open"
              : `${open.length} open`}
        </span>
      </div>
      {!rowsServed ? (
        <NotRead
          what="infrastructure degradations"
          state={deg.state}
          testId="coord-home.degrading.not-read"
          error={deg.error}
        />
      ) : (
        <>
          {deg.state === "stale" && (
            <p
              className="m-0 text-sm text-muted-foreground"
              data-testid="coord-home.degrading.incomplete"
              // R8: coord's own reason names raw source ids, so it is kept
              // for the title only, and only on the `unknown` headline, the
              // one whose reason explains the gap; the sentence is built from
              // structure. While presenting not even the title carries it.
              title={
                presenting
                  ? undefined
                  : (degradationsGapTitle(deg) ?? undefined)
              }
            >
              Incomplete view —{" "}
              {degradationsGapPhrase(deg, sources, planeWords)}. The rows below
              are real; there may be others.
            </p>
          )}
          {open === null && (
            <p
              className="m-0 text-sm text-muted-foreground"
              data-testid="coord-home.degrading.no-list"
            >
              Coord served no list of open degradations, so this view cannot say
              whether any exist.
            </p>
          )}
          {rows.length === 0 ? (
            open === null ? null : deg.state === "read" &&
              deg.headline === "none" ? (
              machinesAllHealthy(machines) ? (
                <p
                  className="m-0 text-sm"
                  data-testid="coord-home.degrading.empty"
                >
                  {stale
                    ? `Nothing was degrading ${lastGoodReadPhrase(generatedAt)}`
                    : "Nothing is degrading"}
                </p>
              ) : (
                <p
                  className="m-0 text-sm text-muted-foreground"
                  data-testid="coord-home.degrading.machines-not-calm"
                >
                  {machines.state === "read" &&
                  machines.counts !== null &&
                  machines.counts.degrading > 0
                    ? "No open degradation was served, but a machine is in a degrading state — see Machines below."
                    : machines.state === "read" &&
                        machines.counts !== null &&
                        machines.counts.total === 0
                      ? "No open degradation was served, but coord lists no machines, so this view cannot say nothing is degrading — see Machines below."
                      : "No open degradation was served, but machine health is not fully known, so this view cannot say nothing is degrading."}
                </p>
              )
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                No open degradation was served, but coord cannot say none exist.
              </p>
            )
          ) : (
            <RecordList
              items={rows}
              itemKey={(r, i) =>
                rowKey("degrading", `${r.kind}:${r.d.id}:${i}`)
              }
              renderRow={(r, ctx) => (
                <DegradationRow
                  d={r.d}
                  kind={r.kind}
                  expanded={ctx.expanded}
                  onToggle={ctx.onToggle}
                />
              )}
            />
          )}
          <CollapsiblePanel
            title="Recently cleared"
            titleAs="h3"
            defaultOpen={false}
            summary={
              <StatCluster
                stats={[
                  {
                    key: "cleared",
                    label: `last ${windowLabel(deg.recentlyClearedWindowSecs) ?? "window"} `,
                    // Exact only on a read block: a stale block's rows are
                    // not known to be all of them.
                    value:
                      deg.state === "read" && deg.recentlyCleared !== null
                        ? cleared.length
                        : null,
                    tone: "muted",
                  },
                ]}
                data-testid="coord-home.degrading.cleared-count"
              />
            }
            data-testid="coord-home.degrading.cleared"
            data-ui-bridge-id="coord-home.degrading.cleared"
          >
            {deg.recentlyCleared === null ? (
              <p className="m-0 text-sm text-muted-foreground">
                Coord served no list of recently cleared degradations — unknown.
              </p>
            ) : cleared.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                {deg.state === "read"
                  ? `Nothing cleared in the last ${windowLabel(deg.recentlyClearedWindowSecs) ?? "window"}.`
                  : "None served; this view is incomplete, so there may be some."}
              </p>
            ) : (
              <RecordList
                items={cleared}
                itemKey={(d, i) => rowKey("cleared", `cleared:${d.id}:${i}`)}
                renderRow={(d, ctx) => (
                  <DegradationRow
                    d={d}
                    kind="cleared"
                    expanded={ctx.expanded}
                    onToggle={ctx.onToggle}
                  />
                )}
              />
            )}
          </CollapsiblePanel>
        </>
      )}
      <MachineHealthLine
        machines={machines}
        listed={
          rowsServed && open !== null && machines.counts !== null
            ? degradingCoverage(machines.counts, open).listed
            : null
        }
      />
      <div
        className="space-y-0.5 text-xs text-muted-foreground"
        data-testid="coord-home.degrading.planes"
        data-ui-bridge-id="coord-home.degrading.planes"
      >
        {deg.planes === null ? (
          <p className="m-0">
            Watcher freshness per area: not served — unknown.
          </p>
        ) : (
          <>
            {stale && (
              <p
                className="m-0"
                data-testid="coord-home.degrading.planes.stale"
              >
                Watcher freshness {lastGoodReadPhrase(generatedAt)}:
              </p>
            )}
            <ul className="m-0 pl-0 list-none space-y-0.5">
              {deg.planes.map((p) => (
                <li
                  key={p.plane}
                  // Coord's own key: not on the element while presenting a
                  // plane the table does not name.
                  data-plane={
                    presenting && !isKnownPlane(p.plane) ? undefined : p.plane
                  }
                  // Watcher names are coord's internal vocabulary: a title
                  // for the operator only.
                  title={
                    presenting ? undefined : planeWatcherNames(p) || undefined
                  }
                >
                  {planeName(p.plane)}: {planeFreshnessPhrase(p)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Work by state
// ---------------------------------------------------------------------------

function groupSummary(g: RepoGroup, windowSecs: number | null): string {
  const c = g.classes;
  const n = (v: number | null) => (v === null ? "–" : String(v));
  const waiting =
    c.waiting_on_gate === null || c.blocked_on_dependency === null
      ? null
      : c.waiting_on_gate + c.blocked_on_dependency;
  return [
    `shipped ${n(c.shipped)}`,
    `in flight ${n(c.in_flight)}`,
    `no recorded change in ${stallWindowDays(windowSecs)} days ${n(c.stalled)}`,
    `waiting ${n(waiting)}`,
  ].join(" · ");
}

/** The repositories a named unit may belong to, per named list (`namedUnitRepos`). */
type UnitRepos = Readonly<
  Record<NamedListKind, (slug: string) => readonly string[] | null>
>;

/**
 * One named unit. Its title — or its slug when it has none — is free text
 * attributed to every repository it may belong to (`namedUnitRepos`), so
 * while presenting it shows only when all of them are first-party. Its link's
 * URL carries the slug, so a unit is linked only when its name AND its slug
 * clear the scope: a slug can name a client under a title that does not. A
 * unit that fails is not even handed to `LensLink`, which renders plain text
 * today (the unit's page is not presentation-ready) and would render an anchor
 * carrying the slug the day `/admin/coord/work-units/[slug]` is registered.
 * The page tests pin that by asking for neither an anchor nor a
 * `data-lens-link` (which `LensLink` puts on both of its arms), so the guard
 * is not dormant until then.
 */
function NamedUnitItem({
  u,
  kind,
  list,
  repos,
}: {
  u: NamedUnit;
  kind: "no_recorded_change" | "waiting_on_condition";
  list: NamedListKind;
  repos: readonly string[] | null;
}) {
  const { presenting } = usePresentationMode();
  const scope = usePresentationScopeState();
  const redact = useRedactor();
  const text = u.title ?? u.slug;
  const descriptor = namedUnitDescriptor(u, list);
  const linkable =
    !presenting ||
    [text, u.slug].every(
      (shown) => redactionVerdict({ text: shown, repo: repos }, scope).show
    );
  const title = redact({ text, repo: repos, descriptor });
  const name = (
    <RedactedText text={text} repo={repos} descriptor={descriptor} />
  );
  return (
    <li className="flex items-center gap-2 min-w-0">
      <HomeBadge
        kind={kind}
        label={kind === "no_recorded_change" ? "no recorded change" : "waiting"}
      />
      {linkable ? (
        <LensLink
          href={`/admin/coord/work-units/${encodeURIComponent(u.slug)}`}
          className="truncate underline underline-offset-2"
          textClassName="truncate"
          title={title}
        >
          {name}
        </LensLink>
      ) : (
        <span className="truncate" title={title}>
          {name}
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {namedUnitAgePhrase(u)}
      </span>
    </li>
  );
}

function NamedUnits({
  title,
  list,
  kind,
  reposOf,
}: {
  title: string;
  list: NamedList | null;
  kind: "no_recorded_change" | "waiting_on_condition";
  reposOf: (slug: string) => readonly string[] | null;
}) {
  const listKind: NamedListKind =
    kind === "no_recorded_change" ? "stalled" : "waitingOnGate";
  if (list === null) {
    return (
      <p className="m-0 text-muted-foreground">
        {title}: coord served no list — unknown.
      </p>
    );
  }
  if (list.units.length === 0) {
    return <p className="m-0 text-muted-foreground">{title}: none.</p>;
  }
  return (
    <div className="space-y-1">
      <p className="m-0 text-muted-foreground">{title}</p>
      <ul
        className="m-0 space-y-1 pl-0 list-none"
        data-testid={`coord-home.on-track.named.${kind}`}
      >
        {list.units.map((u) => (
          <NamedUnitItem
            key={u.slug}
            u={u}
            kind={kind}
            list={listKind}
            repos={reposOf(u.slug)}
          />
        ))}
      </ul>
      {list.omitted !== null && list.omitted > 0 && (
        <p className="m-0 text-xs text-muted-foreground">
          and {list.omitted} more not named here.
        </p>
      )}
      {list.omitted === null && (
        <p className="m-0 text-xs text-muted-foreground">
          Whether more exist is unknown.
        </p>
      )}
    </div>
  );
}

/**
 * Every unit a repository group counts, accounted for one click down: each
 * class's count (`groupBreakdown`), and — because coord names the units of
 * only two classes here — how many of the counted units are listed on the
 * Work units page instead, with the link where it opens (`useLinkOpens`).
 */
function GroupUnitsAccount({
  g,
  windowSecs,
}: {
  g: RepoGroup;
  windowSecs: number | null;
}) {
  const opens = useLinkOpens();
  const b = groupBreakdown(g);
  const unnamed = unnamedUnitsSentence(b.unnamed);
  return (
    <div
      className="space-y-1 text-muted-foreground"
      data-testid="coord-home.on-track.group.classes"
    >
      <p className="m-0">{groupBreakdownSentence(b, windowSecs)}</p>
      {unnamed !== null && (
        <p className="m-0" data-testid="coord-home.on-track.group.unnamed">
          {unnamed}
          {b.unnamed === null ? null : opens("/admin/coord/work-units") ? (
            <>
              {b.unnamed === 1 ? "; it is on" : "; they are on"}{" "}
              <LensLink href="/admin/coord/work-units" className="underline">
                Work units
              </LensLink>
              .
            </>
          ) : (
            "."
          )}
        </p>
      )}
    </div>
  );
}

function RepoGroupRow({
  g,
  windowSecs,
  expanded,
  onToggle,
  unitRepos,
  aliases,
}: {
  g: RepoGroup;
  windowSecs: number | null;
  expanded: boolean;
  onToggle: () => void;
  unitRepos: UnitRepos;
  /** The section's repository aliases, kept across polls. */
  aliases: RepositoryAliases;
}) {
  const { presenting } = usePresentationMode();
  const scope = usePresentationScopeState();
  const days = stallWindowDays(windowSecs);
  // A repository's name can be a client's (D3.3): it shows while presenting
  // only when the scope clears it, and the sentence below says "this
  // repository" rather than repeat a descriptor.
  const key = g.key;
  const keyShown =
    key !== null &&
    (!presenting || redactionVerdict({ text: key, repo: key }, scope).show);
  // A withheld repository is its alias ("Repository A"), so two withheld
  // repositories never read as one; the alias is all the presentation says.
  const alias =
    presenting && g.kind === "repo" && key !== null && !keyShown
      ? aliases.alias(key)
      : null;
  return (
    <RecordRow
      identity={
        g.kind !== "repo" ? (
          "no repo named"
        ) : key === null ? (
          "repo"
        ) : (
          <RedactedText
            text={key}
            repo={key}
            descriptor={
              alias === null
                ? REPOSITORY_DESCRIPTOR
                : repositoryAliasDescriptor(alias)
            }
          />
        )
      }
      label={groupSummary(g, windowSecs)}
      status={<HomeBadge kind="repo_group" label={unitCountText(g.rowCount)} />}
      attention={HOME_ATTENTION_BY_KIND.repo_group}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-home.on-track.group"
    >
      <RecordDetail
        why={
          <p className="m-0">
            {g.kind === "unattributed_repo"
              ? "Work units that name no repository. They are counted here rather than dropped."
              : `Work units that name ${keyShown ? key : (alias ?? "this repository")}. A unit naming several repositories is counted under each.`}
          </p>
        }
        problems={
          <div className="space-y-2">
            <GroupUnitsAccount g={g} windowSecs={windowSecs} />
            <NamedUnits
              title={`No recorded change in ${days} days`}
              list={g.named.stalled}
              kind="no_recorded_change"
              reposOf={unitRepos.stalled}
            />
            <NamedUnits
              title="Waiting on a condition"
              list={g.named.waitingOnGate}
              kind="waiting_on_condition"
              reposOf={unitRepos.waitingOnGate}
            />
          </div>
        }
      />
    </RecordRow>
  );
}

/**
 * The current initiative. Its document is the tenant's own writing, and
 * coord's reasons about it are written for agents, so while presenting each
 * in-scope item and each reason renders through `RedactedText` (no repository
 * vouches for them: always a descriptor), and the frontmatter's status and
 * dates show only in a shape that cannot name anyone (`homeLens.ts`).
 */
function InitiativeBlock({
  onTrack,
  generatedAt,
}: {
  onTrack: OnTrackView;
  generatedAt: string | null;
}) {
  const { presenting } = usePresentationMode();
  const i = onTrack.initiative;
  let body: ReactNode;
  if (i === null) {
    body = (
      <p className="m-0 text-muted-foreground">
        Coord served no initiative reading — unknown.
      </p>
    );
  } else if (i.state === "unparseable" && presenting) {
    // Coord's parser message quotes the document, and a descriptor in its
    // place reads as a garbled clause: a fixed sentence says it instead.
    body = (
      <p
        className="m-0 text-muted-foreground"
        data-testid="coord-home.on-track.initiative.unparseable"
      >
        {INITIATIVE_UNPARSEABLE_SENTENCE}
      </p>
    );
  } else if (i.state === "unparseable") {
    body = (
      <p className="m-0 text-muted-foreground">
        The current initiative document could not be parsed:{" "}
        {i.error ? (
          <RedactedText
            text={withoutVerdictWords(i.error)}
            repo={null}
            descriptor={reasonDescriptor("could not be parsed", generatedAt)}
          />
        ) : (
          "no reason given"
        )}
        .
      </p>
    );
  } else if (i.state !== "read") {
    body = (
      <p className="m-0 text-muted-foreground">
        {notReadSentence("the current initiative", i.state)}
      </p>
    );
  } else if (i.alignment === "no_live_initiative") {
    body = (
      <p className="m-0 text-muted-foreground">
        No live initiative
        {i.reason ? (
          <>
            {" — "}
            <RedactedText
              text={withoutVerdictWords(i.reason)}
              repo={null}
              descriptor={reasonDescriptor("no live initiative", generatedAt)}
            />
          </>
        ) : (
          ""
        )}
        .
      </p>
    );
  } else {
    const status = presenting
      ? presentedInitiativeStatus(i.status)
      : (i.status ?? "unknown");
    const starts =
      (presenting ? presentedInitiativeDate(i.starts) : i.starts) ?? "unknown";
    const ends =
      (presenting ? presentedInitiativeDate(i.ends) : i.ends) ?? "unknown";
    const unknownKeys = i.unknownKey?.keys.join(", ") ?? "";
    body = (
      <div className="space-y-1">
        <p className="m-0">
          Status {status} · from {starts} · ends {ends} ·{" "}
          <span data-testid="coord-home.on-track.initiative.alignment">
            {initiativeAttributionPhrase(i)}
          </span>
        </p>
        {i.inScope === null ? (
          <p className="m-0 text-muted-foreground">
            In scope: not served — unknown.
          </p>
        ) : (
          <ul
            className="m-0 pl-4 list-disc"
            data-testid="coord-home.on-track.initiative.in-scope"
          >
            {i.inScope.map((item, idx) => (
              <li key={item.key ?? idx}>
                <RedactedText
                  text={item.text}
                  repo={null}
                  descriptor={INITIATIVE_ITEM_DESCRIPTOR}
                />
                {item.units && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {attributedText(item.units)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {i.unattributed && (
          <p
            className="m-0 text-xs text-muted-foreground"
            data-testid="coord-home.on-track.initiative.unattributed"
          >
            Not linked to any in-scope item: {attributedText(i.unattributed)}.
          </p>
        )}
        {i.unknownKey &&
          (i.unknownKey.total === null ||
            i.unknownKey.total > 0 ||
            i.unknownKey.keys.length > 0) && (
            <p
              className="m-0 text-xs text-muted-foreground"
              data-testid="coord-home.on-track.initiative.unknown-key"
            >
              Linked to an item this initiative does not list (
              {unknownKeys ? (
                <RedactedText
                  text={unknownKeys}
                  repo={null}
                  descriptor={INITIATIVE_KEYS_DESCRIPTOR}
                />
              ) : (
                "keys not served"
              )}
              ): {attributedText(i.unknownKey)}.
            </p>
          )}
      </div>
    );
  }
  return (
    <div
      className="space-y-1 text-sm"
      data-ui-bridge-id="coord-home.on-track.initiative"
      data-testid="coord-home.on-track.initiative"
    >
      <h3 className={HEADING}>Current initiative</h3>
      {body}
    </div>
  );
}

export function OnTrackSection({
  onTrack,
  stale = false,
  generatedAt = null,
}: {
  onTrack: OnTrackView;
  /** The latest poll failed; this is the last good read (style guide R6). */
  stale?: boolean;
  generatedAt?: string | null;
}) {
  const rowKey = useRowKey();
  const [repoAliases] = useState(() => new RepositoryAliases());
  const read = onTrack.state === "read";
  const stallWindow = onTrack.stallWindowSecs;
  // Which repositories each named unit may belong to — read once from every
  // group, since a unit is named under each of its repositories.
  const unitRepos = useMemo<UnitRepos>(
    () => ({
      stalled: namedUnitRepos(onTrack.groups, "stalled"),
      waitingOnGate: namedUnitRepos(onTrack.groups, "waitingOnGate"),
    }),
    [onTrack.groups]
  );
  const stats: Stat[] = UNIT_CLASSES.map((cls) => ({
    key: cls,
    label: `${unitClassLabel(cls, stallWindow)} `,
    value: read && onTrack.totals ? onTrack.totals[cls] : null,
    tone: "default",
    "data-testid": `coord-home.on-track.total.${cls}`,
  }));
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.on-track"
      data-testid="coord-home.on-track"
      data-block-state={onTrack.state}
    >
      <RegionCaption region="on-track" reading={{ generatedAt, kept: stale }} />
      <div className="flex items-baseline gap-2">
        <h2 className={HEADING}>Work by state</h2>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="coord-home.on-track.count"
        >
          {read
            ? unitCountText(onTrack.rowCount, "work unit")
            : BLOCK_STATE_PHRASE[onTrack.state]}
        </span>
      </div>
      <StatCluster stats={stats} data-testid="coord-home.on-track.totals" />
      {!read ? (
        <NotRead
          what="work-unit progress"
          state={onTrack.state}
          testId="coord-home.on-track.not-read"
          error={onTrack.error}
        />
      ) : (
        <>
          {onTrack.historyNotRecorded !== null &&
            onTrack.historyNotRecorded > 0 && (
              <p className="m-0 text-xs text-muted-foreground">
                {onTrack.historyNotRecorded} in-progress unit
                {onTrack.historyNotRecorded === 1 ? " has" : "s have"} no
                recorded history, so{" "}
                {onTrack.historyNotRecorded === 1 ? "it is" : "they are"}{" "}
                counted in flight rather than judged.
              </p>
            )}
          <RecordList
            // coord always serves the unattributed group, even at zero; an
            // empty one is noise and would mask the "No work units." state.
            items={(onTrack.groups ?? []).filter(
              (g) => !(g.kind === "unattributed_repo" && g.rowCount === 0)
            )}
            itemKey={(g, i) =>
              rowKey("group", `${g.kind}:${g.key ?? "none"}:${i}`)
            }
            empty={
              <p className="m-0 text-sm text-muted-foreground">
                {onTrack.groups === null
                  ? "Coord served no per-repo breakdown — unknown."
                  : "No work units."}
              </p>
            }
            renderRow={(g, ctx) => (
              <RepoGroupRow
                g={g}
                windowSecs={stallWindow}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
                unitRepos={unitRepos}
                aliases={repoAliases}
              />
            )}
          />
        </>
      )}
      <InitiativeBlock onTrack={onTrack} generatedAt={generatedAt} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. Correct?
// ---------------------------------------------------------------------------

/**
 * Correct? — one read-only row, present from day one so its absence is
 * visible. It carries no write control in either mode; the row's toggle is a
 * disclosure, and coord's reason token on its raw last line is the
 * operator's, not rendered while presenting (D3.3).
 */
export function CorrectSection({
  correctness,
  expanded,
  onToggle,
  stale = false,
  generatedAt = null,
}: {
  correctness: CorrectnessView;
  expanded: boolean;
  onToggle: () => void;
  /** The latest poll failed; this is the last good read (style guide R6). */
  stale?: boolean;
  generatedAt?: string | null;
}) {
  const { presenting } = usePresentationMode();
  const measured = correctness.state === "read";
  // "No source" only when coord SAYS no source exists. Any other unread state
  // (could not read, stale, absent from the body) says nothing about a source.
  const noSource = correctnessHasNoSource(correctness);
  // A section with nothing built behind it is left out of the presented
  // page; the operator still sees it, so its absence stays visible there.
  if (presenting && (noSource || correctness.state === "not_implemented")) {
    return null;
  }
  const label = measured
    ? "Coord reports a correctness reading; this page does not render it yet"
    : noSource
      ? "Not measured — no trust-calibration source"
      : notReadSentence("trust calibration", correctness.state);
  const why = measured
    ? "The reading exists in coord's answer; it is not shown here."
    : noSource
      ? "No source measures it yet, so this is not measured rather than zero."
      : "Until coord gives a full reading, it is unknown rather than zero.";
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.correct"
      data-testid="coord-home.correct"
      data-block-state={correctness.state}
    >
      <RegionCaption region="correct" reading={{ generatedAt, kept: stale }} />
      <h2 className={HEADING}>Correct?</h2>
      <RecordRow
        identity="verified work"
        label={label}
        status={
          <HomeBadge
            kind={measured ? "source_read" : "source_not_read"}
            label={measured ? "read" : BLOCK_STATE_PHRASE[correctness.state]}
          />
        }
        attention={
          HOME_ATTENTION_BY_KIND[measured ? "source_read" : "source_not_read"]
        }
        expanded={expanded}
        onToggle={onToggle}
        data-testid="coord-home.correct.row"
      >
        <RecordDetail
          why={
            <p className="m-0">
              How much of what the fleet says it verified survives independent
              checking. {why}
            </p>
          }
          raw={
            correctness.reason && !presenting ? (
              <span className="font-mono text-[10px] text-muted-foreground/60 break-all">
                {withoutVerdictWords(correctness.reason)}
              </span>
            ) : undefined
          }
        />
      </RecordRow>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6. What this view does not know
// ---------------------------------------------------------------------------

/** One source coord lists in `does_not_know`, as a record row. */
function SourceRow({
  s,
  planes,
  expanded,
  onToggle,
}: {
  s: SourceCoverageView;
  planes: PlaneView[] | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { presenting } = usePresentationMode();
  const words = sourceTimeWords(s);
  return (
    <RecordRow
      identity={s.state === "read" ? "read" : "not read"}
      // R8: words on the row; coord's raw id only in the title and the
      // detail's last line — both the operator's alone.
      label={
        <span title={presenting ? undefined : s.source}>
          {presenting
            ? // A source the table does not label would read as coord's
              // identifier: fixed words while presenting.
              presentedSourceLabel(s.source, planes)
            : sourceLabel(s.source, planes)}
        </span>
      }
      status={
        <HomeBadge
          kind={s.state === "read" ? "source_read" : "source_not_read"}
          label={BLOCK_STATE_PHRASE[s.state]}
        />
      }
      // A clause coord did not state is said once, under the list
      // (`unstatedSummary`), not on every row.
      reason={sourceRowReason(s, { omitUnstated: true })}
      time={
        <RowTime
          at={s.asOf}
          verb={words.verb}
          absent={{ label: words.absentLabel, title: words.absentTitle }}
        />
      }
      attention={
        HOME_ATTENTION_BY_KIND[
          s.state === "read" ? "source_read" : "source_not_read"
        ]
      }
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-home.does-not-know.row"
    >
      <RecordDetail
        why={
          <div className="space-y-1">
            <p className="m-0">
              {s.state === "read"
                ? `Read ${relativeTime(s.asOf, { absent: "at an unknown time" })}.`
                : `This source is ${BLOCK_STATE_PHRASE[s.state]}.`}
              {s.error
                ? // Coord's own error chain is quoted on the raw line, which
                  // is not rendered while presenting.
                  ` ${
                    presenting && !isWatcherSource(s.source)
                      ? `Coord reported an error. ${FAILURE_SENTENCE_WITHHELD}`
                      : sourceErrorSentence(s)
                  }`
                : ""}
            </p>
            <p className="m-0 text-muted-foreground">
              Freshness bound:{" "}
              {s.freshnessBoundSecs === null
                ? "not stated"
                : boundText(s.freshnessBoundSecs)}
              {" · "}Rows considered: {s.rowsConsidered ?? "not stated"}
              {" · "}Rows excluded: {s.rowsExcluded ?? "not stated"}
            </p>
            {s.exclusionReason && (
              <p className="m-0 text-muted-foreground">
                Why excluded:{" "}
                <RedactedText
                  text={withoutVerdictWords(s.exclusionReason)}
                  repo={null}
                  descriptor={reasonDescriptor("excluded", s.asOf)}
                />
              </p>
            )}
          </div>
        }
        raw={
          // R8's raw last line — coord's source id and error chain — is the
          // operator's: not rendered while presenting.
          presenting ? undefined : (
            <span
              className="font-mono text-[10px] text-muted-foreground/60 break-all"
              data-testid="coord-home.does-not-know.raw"
            >
              {sourceRawLine(s)}
            </span>
          )
        }
      />
    </RecordRow>
  );
}

/** A list of sources, then the one line for the clauses coord did not state. */
function SourceList({
  sources,
  list,
  planes,
  testId,
}: {
  sources: SourceCoverageView[];
  list: string;
  planes: PlaneView[] | null;
  testId: string;
}) {
  const rowKey = useRowKey();
  const unstated = unstatedSummary(sources);
  return (
    <div className="space-y-1">
      <RecordList
        items={sources}
        itemKey={(s, i) => rowKey(list, `${s.source}:${i}`)}
        renderRow={(s, ctx) => (
          <SourceRow
            s={s}
            planes={planes}
            expanded={ctx.expanded}
            onToggle={ctx.onToggle}
          />
        )}
      />
      {unstated !== null && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid={`${testId}.unstated`}
        >
          {unstated}
        </p>
      )}
    </div>
  );
}

/**
 * What this view does not know. The sources coord could not fully read are
 * the section's answer, so they are listed; the sources it read answer no
 * question the section asks, so they sit behind one disclosure with their
 * count. Neither list repeats a clause coord did not state on every row: it
 * says it once, counted (`unstatedSummary`).
 */
export function DoesNotKnowSection({
  sources,
  planes = null,
  stale = false,
  generatedAt = null,
}: {
  sources: SourceCoverageView[] | null;
  /** The degradations planes, which name the area a watcher row feeds. */
  planes?: PlaneView[] | null;
  /** The latest poll failed; this is the last good read (style guide R6). */
  stale?: boolean;
  generatedAt?: string | null;
}) {
  const { presenting } = usePresentationMode();
  const notRead = sources?.filter((s) => s.state !== "read") ?? [];
  const read = sources?.filter((s) => s.state === "read") ?? [];
  // While presenting, a source coord has not built yet is not listed: one
  // line counts them, so the header's figure still adds up.
  const unbuilt = presenting
    ? notRead.filter((s) => s.state === "not_implemented")
    : [];
  const unread = presenting
    ? notRead.filter((s) => s.state !== "not_implemented")
    : notRead;
  const count =
    sources === null
      ? "unknown"
      : `${notRead.length} of ${sources.length} sources not read`;
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.does-not-know"
      data-testid="coord-home.does-not-know"
    >
      <RegionCaption
        region="does-not-know"
        reading={{ generatedAt, kept: stale }}
      />
      <div className="flex items-baseline gap-2">
        <h2 className={HEADING}>What this view does not know</h2>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="coord-home.does-not-know.count"
        >
          {count}
        </span>
      </div>
      {sources === null ? (
        <p className="m-0 text-sm text-muted-foreground">
          Coord served no list of the sources it read, so what this view does
          not know is itself unknown.
        </p>
      ) : sources.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          Coord listed no sources — unknown.
        </p>
      ) : (
        <>
          {notRead.length === 0 ? (
            <p
              className="m-0 text-sm"
              data-testid="coord-home.does-not-know.all-read"
            >
              {stale
                ? `Coord had read every source it lists ${lastGoodReadPhrase(generatedAt)}.`
                : "Coord read every source it lists."}
            </p>
          ) : (
            unread.length > 0 && (
              <SourceList
                sources={unread}
                list="source"
                planes={planes}
                testId="coord-home.does-not-know.not-read"
              />
            )
          )}
          {unbuilt.length > 0 && (
            <p
              className="m-0 text-sm text-muted-foreground"
              data-testid="coord-home.does-not-know.not-built"
            >
              {unbuilt.length === 1
                ? "1 further source is not built yet, so this view does not show it."
                : `${unbuilt.length} further sources are not built yet, so this view does not show them.`}
            </p>
          )}
          {read.length > 0 && (
            <CollapsiblePanel
              title="Sources read"
              titleAs="h3"
              defaultOpen={false}
              summary={
                <StatCluster
                  stats={[
                    {
                      key: "read",
                      label: "read ",
                      value: read.length,
                      tone: "muted",
                    },
                  ]}
                  data-testid="coord-home.does-not-know.read-count"
                />
              }
              data-testid="coord-home.does-not-know.read"
              data-ui-bridge-id="coord-home.does-not-know.read"
            >
              <SourceList
                sources={read}
                list="source-read"
                planes={planes}
                testId="coord-home.does-not-know.read"
              />
            </CollapsiblePanel>
          )}
        </>
      )}
    </section>
  );
}
