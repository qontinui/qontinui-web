"use client";

/**
 * The six regions of `/admin/coord/home`, top to bottom — plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4:
 *
 *   1. the strip — one derived headline, never green over a block not read;
 *   2. Needs you — operator forks, each as fork + recommendation;
 *   3. Degrading — open degradations with their onset, recently cleared folded;
 *   4. On track — class totals, then one row per repo expanding to named units;
 *   5. Correct? — present from day one so its absence is visible;
 *   6. What this view does not know — always rendered, never collapsed.
 *
 * Composition only (style guide §6.4): every visual element here is a console
 * primitive. Every derivation — the strip, the labels, the "may we say nothing
 * needs you" predicate — lives in `coordHomeStatus.ts`, which is unit-tested;
 * nothing below decides a colour or a word on its own (R8).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  CollapsiblePanel,
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatCluster,
  StatusBadge,
  absoluteTime,
  relativeTime,
  staleDetail,
  type Stat,
} from "@/components/console";
import {
  BLOCK_STATE_PHRASE,
  HOME_ATTENTION_BY_KIND,
  HOME_STATUS_PALETTE,
  UNIT_CLASSES,
  durationText,
  needsYouReason,
  needsDisplayCount,
  nothingNeedsYou,
  lastGoodReadPhrase,
  openDegradations,
  planeFreshnessPhrase,
  planeWatcherNames,
  decisionDomainLabel,
  withoutVerdictWords,
  planeLabel,
  remediationPhrase,
  stallWindowDays,
  unitClassLabel,
  type BlockState,
  type CorrectnessView,
  type DegradationView,
  type DegradationsView,
  type HomeRowKind,
  type HomeStrip,
  type NamedList,
  type NeedsMeItem,
  type NeedsMeView,
  type OnTrackView,
  type RepoGroup,
  type SourceCoverageView,
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

/** The sentence a block renders in place of its content when it is not read. */
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
      return `Not known — coord's answer about ${what} was not recognised.`;
  }
}

function NotRead({
  what,
  state,
  testId,
  children,
}: {
  what: string;
  state: BlockState;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="text-sm text-muted-foreground space-y-1"
      data-testid={testId}
      data-block-state={state}
    >
      <p className="m-0">{notReadSentence(what, state)}</p>
      {children}
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
  lastError,
  onRefresh,
}: {
  strip: HomeStrip;
  tenantName: string | null;
  tenantId: string | null;
  stale: boolean;
  generatedAt: string | null;
  lastError: string | null;
  onRefresh: () => Promise<void>;
}) {
  const tenant = tenantId
    ? `Tenant: ${tenantName ?? "not in your project list"} (${tenantId})`
    : "Tenant: not stated by coord";
  const age = generatedAt
    ? `Showing coord's answer from ${relativeTime(generatedAt)} (${absoluteTime(generatedAt)}).`
    : "";
  const detail = [
    stale ? staleDetail(age) : null,
    stale && lastError ? `Last failure: ${lastError}.` : null,
    strip.detail,
    tenant,
  ]
    .filter(Boolean)
    .join(" ");
  return (
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
      <RefreshButton
        onRefresh={onRefresh}
        label="Refresh project state"
        title="Re-read coord's project state now instead of waiting for the next minute"
        data-testid="coord-home.refresh"
      />
    </section>
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
  const hasRecommendation = item.recommendation !== null;
  return (
    <RecordRow
      identity={item.source === "operator_gate" ? "gate" : "question"}
      label={
        <span title={item.fork ?? undefined}>
          {item.fork ?? "(no question text)"}
        </span>
      }
      status={
        <HomeBadge
          kind="needs_you"
          label={hasRecommendation ? "decide" : "open question"}
        />
      }
      reason={needsYouReason(item)}
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
              {item.recommendation ?? "open question — no recommendation"}
            </p>
            <p className="m-0">
              <span className="text-muted-foreground">
                If you overturn it:{" "}
              </span>
              {item.ifOverturned ?? "not stated"}
            </p>
            {item.options === null ? (
              <p className="m-0 text-muted-foreground">Options: not readable</p>
            ) : (
              item.options.length > 0 && (
                <p className="m-0 text-muted-foreground">
                  Options: {item.options.join(" · ")}
                </p>
              )
            )}
            {item.blocking &&
              (item.blocking.workUnitSlug || item.blocking.planPhase) && (
                <p className="m-0 text-muted-foreground">
                  Blocks:{" "}
                  {item.blocking.workUnitSlug ? (
                    <Link
                      href={`/admin/coord/work-units/${encodeURIComponent(item.blocking.workUnitSlug)}`}
                      className="underline underline-offset-2"
                    >
                      {item.blocking.workUnitSlug}
                    </Link>
                  ) : (
                    "a piece of work"
                  )}
                  {item.blocking.planPhase
                    ? `, phase ${item.blocking.planPhase}`
                    : ""}
                </p>
              )}
          </div>
        }
        actions={
          item.answerAt ? (
            <Link
              href={item.answerAt}
              className="text-sm underline underline-offset-2"
              data-testid="coord-home.needs-you.answer"
            >
              Answer it ↗
            </Link>
          ) : (
            <p className="m-0 text-muted-foreground">
              Coord served no page to answer this on.
            </p>
          )
        }
        raw={
          <span className="font-mono text-[10px] text-muted-foreground/60 break-all">
            {item.source ?? "source unknown"} · {item.id}
          </span>
        }
      />
    </RecordRow>
  );
}

export function NeedsYouSection({
  needs,
  stale = false,
  generatedAt = null,
}: {
  needs: NeedsMeView;
  /** The latest poll failed; this is the last good read (style guide R6). */
  stale?: boolean;
  generatedAt?: string | null;
}) {
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
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.needs-you"
      data-testid="coord-home.needs-you"
      data-block-state={needs.state}
    >
      <div className="flex items-baseline gap-2">
        <h2 className={HEADING}>Needs you</h2>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          data-testid="coord-home.needs-you.count"
        >
          {header}
        </span>
      </div>
      {read && needs.byDomain && Object.keys(needs.byDomain).length > 0 && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-home.needs-you.by-domain"
        >
          By kind of decision:{" "}
          {Object.entries(needs.byDomain)
            .map(([domain, n]) => `${decisionDomainLabel(domain)} ${n}`)
            .join(" · ")}
        </p>
      )}
      {read && needs.retirement === "unsupported" && (
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="coord-home.needs-you.retirement"
        >
          This list may contain questions whose condition has already resolved:
          coord cannot retire them on this database.
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
          <p className="m-0 text-sm text-muted-foreground">
            Coord counted {count ?? "an unknown number of"} decisions for you
            but served none of them; open{" "}
            <Link href="/admin/coord/questions" className="underline">
              Questions
            </Link>
            .
          </p>
        ) : (
          <RecordList
            items={needs.items ?? []}
            itemKey={(i, idx) => `${i.source ?? "item"}:${i.id}:${idx}`}
            renderRow={(item, ctx) => (
              <NeedsYouRow
                item={item}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
          />
        )
      ) : (
        <NotRead
          what="the decisions waiting on you"
          state={needs.state}
          testId="coord-home.needs-you.not-read"
        >
          <p className="m-0">
            Pending decisions are listed at{" "}
            <Link href="/admin/coord/questions" className="underline">
              Questions
            </Link>{" "}
            and{" "}
            <Link href="/admin/coord/gates" className="underline">
              Gates
            </Link>
            .
          </p>
        </NotRead>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Degrading
// ---------------------------------------------------------------------------

function subjectText(d: DegradationView): string {
  const name = d.subjectName ?? d.subjectId ?? "unnamed subject";
  return d.subjectName && d.subjectId && d.subjectId !== d.subjectName
    ? `${name} (${d.subjectId})`
    : name;
}

function DegradationRow({
  d,
  kind,
  expanded,
  onToggle,
}: {
  d: DegradationView;
  kind: "degrading" | "declared" | "cleared";
  expanded: boolean;
  onToggle: () => void;
}) {
  const label =
    kind === "cleared"
      ? "cleared"
      : kind === "declared"
        ? "declared"
        : "degrading";
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
      identity={planeLabel(d.plane)}
      label={
        <span title={d.headline ?? undefined}>
          {d.headline ?? "(no headline)"}
        </span>
      }
      status={<HomeBadge kind={kind} label={label} />}
      reason={subjectText(d)}
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
          d.drill ? (
            <Link
              href={d.drill}
              className="text-sm underline underline-offset-2"
            >
              Open {d.drill.replace("/admin/coord/", "")} ↗
            </Link>
          ) : undefined
        }
        raw={
          <span className="font-mono text-[10px] text-muted-foreground/60 break-all">
            {d.id}
            {d.autoRemediation?.response
              ? ` · ${d.autoRemediation.response}`
              : ""}
          </span>
        }
      />
    </RecordRow>
  );
}

export function DegradingSection({
  deg,
  stale = false,
  generatedAt = null,
}: {
  deg: DegradationsView;
  /** The latest poll failed; this is the last good read (style guide R6). */
  stale?: boolean;
  generatedAt?: string | null;
}) {
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
        >
          {deg.error && (
            <p className="m-0">Coord said: {withoutVerdictWords(deg.error)}</p>
          )}
        </NotRead>
      ) : (
        <>
          {deg.state === "stale" && (
            <p
              className="m-0 text-sm text-muted-foreground"
              data-testid="coord-home.degrading.incomplete"
            >
              Incomplete view —{" "}
              {deg.headlineReason
                ? withoutVerdictWords(deg.headlineReason)
                : "a source feeding it was not fully read"}
              . The rows below are real; there may be others.
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
              <p
                className="m-0 text-sm"
                data-testid="coord-home.degrading.empty"
              >
                {stale
                  ? `Nothing was degrading ${lastGoodReadPhrase(generatedAt)}`
                  : "Nothing is degrading"}
              </p>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                No open degradation was served, but coord cannot say none exist.
              </p>
            )
          ) : (
            <RecordList
              items={rows}
              itemKey={(r, i) => `${r.kind}:${r.d.id}:${i}`}
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
                    label: "last 24 h ",
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
                  ? "Nothing cleared in the last 24 hours."
                  : "None served; this view is incomplete, so there may be some."}
              </p>
            ) : (
              <RecordList
                items={cleared}
                itemKey={(d, i) => `cleared:${d.id}:${i}`}
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
                  data-plane={p.plane}
                  title={planeWatcherNames(p) || undefined}
                >
                  {planeLabel(p.plane)}: {planeFreshnessPhrase(p)}
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
// 4. On track
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
    `no recorded change ${stallWindowDays(windowSecs)} d ${n(c.stalled)}`,
    `waiting ${n(waiting)}`,
  ].join(" · ");
}

function NamedUnits({
  title,
  list,
  kind,
}: {
  title: string;
  list: NamedList | null;
  kind: "no_recorded_change" | "waiting_on_condition";
}) {
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
          <li key={u.slug} className="flex items-center gap-2 min-w-0">
            <HomeBadge
              kind={kind}
              label={
                kind === "no_recorded_change" ? "no recorded change" : "waiting"
              }
            />
            <Link
              href={`/admin/coord/work-units/${encodeURIComponent(u.slug)}`}
              className="truncate underline underline-offset-2"
              title={u.title ?? u.slug}
            >
              {u.title ?? u.slug}
            </Link>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {u.ageBasis === "last_recorded_change"
                ? `last change ${durationText(u.ageSecs)} ago`
                : `in progress for ${durationText(u.ageSecs)}`}
            </span>
          </li>
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

function RepoGroupRow({
  g,
  windowSecs,
  expanded,
  onToggle,
}: {
  g: RepoGroup;
  windowSecs: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const days = stallWindowDays(windowSecs);
  return (
    <RecordRow
      identity={g.kind === "repo" ? (g.key ?? "repo") : "no repo named"}
      label={groupSummary(g, windowSecs)}
      status={
        <HomeBadge kind="repo_group" label={`${g.rowCount ?? "–"} units`} />
      }
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
              : `Work units that name ${g.key ?? "this repository"}. A unit naming several repositories is counted under each.`}
          </p>
        }
        problems={
          <div className="space-y-2">
            <NamedUnits
              title={`No recorded change in ${days} days`}
              list={g.named.stalled}
              kind="no_recorded_change"
            />
            <NamedUnits
              title="Waiting on a condition"
              list={g.named.waitingOnGate}
              kind="waiting_on_condition"
            />
          </div>
        }
      />
    </RecordRow>
  );
}

function InitiativeBlock({ onTrack }: { onTrack: OnTrackView }) {
  const i = onTrack.initiative;
  let body: ReactNode;
  if (i === null) {
    body = (
      <p className="m-0 text-muted-foreground">
        Coord served no initiative reading — unknown.
      </p>
    );
  } else if (i.state === "unparseable") {
    body = (
      <p className="m-0 text-muted-foreground">
        The current initiative document could not be parsed:{" "}
        {i.error ? withoutVerdictWords(i.error) : "no reason given"}.
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
        {i.reason ? ` — ${withoutVerdictWords(i.reason)}` : ""}.
      </p>
    );
  } else {
    body = (
      <div className="space-y-1">
        <p className="m-0">
          Status {i.status ?? "unknown"}
          {i.starts ? ` · from ${i.starts}` : ""} · ends {i.ends ?? "unknown"} ·{" "}
          <span data-testid="coord-home.on-track.initiative.alignment">
            {i.alignment === "unknown" || i.alignment === null
              ? "work attributed to it: not yet attributable"
              : `alignment: ${i.alignment}`}
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
              <li key={item.key ?? idx}>{item.text}</li>
            ))}
          </ul>
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

export function OnTrackSection({ onTrack }: { onTrack: OnTrackView }) {
  const read = onTrack.state === "read";
  const window = onTrack.stallWindowSecs;
  const stats: Stat[] = UNIT_CLASSES.map((cls) => ({
    key: cls,
    label: `${unitClassLabel(cls, window)} `,
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
      <div className="flex items-baseline gap-2">
        <h2 className={HEADING}>On track</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {read
            ? `${onTrack.rowCount ?? "–"} work units`
            : BLOCK_STATE_PHRASE[onTrack.state]}
        </span>
      </div>
      <StatCluster stats={stats} data-testid="coord-home.on-track.totals" />
      {!read ? (
        <NotRead
          what="work-unit progress"
          state={onTrack.state}
          testId="coord-home.on-track.not-read"
        >
          {onTrack.error && (
            <p className="m-0">
              Coord said: {withoutVerdictWords(onTrack.error)}
            </p>
          )}
        </NotRead>
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
            items={onTrack.groups ?? []}
            itemKey={(g, i) => `${g.kind}:${g.key ?? "none"}:${i}`}
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
                windowSecs={window}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
              />
            )}
          />
        </>
      )}
      <InitiativeBlock onTrack={onTrack} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. Correct?
// ---------------------------------------------------------------------------

export function CorrectSection({
  correctness,
  expanded,
  onToggle,
}: {
  correctness: CorrectnessView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const measured = correctness.state === "read";
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.correct"
      data-testid="coord-home.correct"
      data-block-state={correctness.state}
    >
      <h2 className={HEADING}>Correct?</h2>
      <RecordRow
        identity="verified work"
        label={
          measured
            ? "Coord reports a correctness reading; this page does not render it yet"
            : "Not measured — no trust-calibration source"
        }
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
              checking.{" "}
              {measured
                ? "The reading exists in coord's answer; it is not shown here."
                : "No source measures it yet, so this is not measured rather than zero."}
            </p>
          }
          raw={
            correctness.reason ? (
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

function sourceReason(s: SourceCoverageView): string {
  const parts: string[] = [];
  parts.push(
    s.freshnessBoundSecs === null
      ? "bound –"
      : `bound ${durationText(s.freshnessBoundSecs)}`
  );
  parts.push(`excluded ${s.rowsExcluded ?? "–"}`);
  if (s.error) parts.push(withoutVerdictWords(s.error));
  return parts.join(" · ");
}

export function DoesNotKnowSection({
  sources,
}: {
  sources: SourceCoverageView[] | null;
}) {
  const count =
    sources === null
      ? "unknown"
      : `${sources.filter((s) => s.state !== "read").length} of ${sources.length} sources not read`;
  return (
    <section
      className="space-y-2"
      data-ui-bridge-id="coord-home.does-not-know"
      data-testid="coord-home.does-not-know"
    >
      <div className="flex items-baseline gap-2">
        <h2 className={HEADING}>What this view does not know</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </div>
      {sources === null ? (
        <p className="m-0 text-sm text-muted-foreground">
          Coord served no list of the sources it read, so what this view does
          not know is itself unknown.
        </p>
      ) : (
        <RecordList
          items={sources}
          itemKey={(s, i) => `${s.source}:${i}`}
          empty={
            <p className="m-0 text-sm text-muted-foreground">
              Coord listed no sources — unknown.
            </p>
          }
          renderRow={(s, ctx) => (
            <RecordRow
              identity={s.state === "read" ? "read" : "not read"}
              label={<span title={s.source}>{s.source}</span>}
              status={
                <HomeBadge
                  kind={s.state === "read" ? "source_read" : "source_not_read"}
                  label={BLOCK_STATE_PHRASE[s.state]}
                />
              }
              reason={sourceReason(s)}
              time={
                <RowTime
                  at={s.asOf}
                  verb="Read"
                  absent={{
                    label: "as of: unknown",
                    title: "Coord recorded no read time",
                  }}
                />
              }
              attention={
                HOME_ATTENTION_BY_KIND[
                  s.state === "read" ? "source_read" : "source_not_read"
                ]
              }
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              data-testid="coord-home.does-not-know.row"
            >
              <RecordDetail
                why={
                  <div className="space-y-1">
                    <p className="m-0">
                      {s.state === "read"
                        ? `Read ${relativeTime(s.asOf, { absent: "at an unknown time" })}.`
                        : `This source is ${BLOCK_STATE_PHRASE[s.state]}.`}
                      {s.error ? ` ${withoutVerdictWords(s.error)}` : ""}
                    </p>
                    <p className="m-0 text-muted-foreground">
                      Freshness bound:{" "}
                      {s.freshnessBoundSecs === null
                        ? "not stated"
                        : durationText(s.freshnessBoundSecs)}
                      {" · "}Rows considered: {s.rowsConsidered ?? "not stated"}
                      {" · "}Rows excluded: {s.rowsExcluded ?? "not stated"}
                    </p>
                    {s.exclusionReason && (
                      <p className="m-0 text-muted-foreground">
                        Why excluded: {withoutVerdictWords(s.exclusionReason)}
                      </p>
                    )}
                  </div>
                }
              />
            </RecordRow>
          )}
        />
      )}
    </section>
  );
}
