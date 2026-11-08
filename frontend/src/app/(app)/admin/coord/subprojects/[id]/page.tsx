"use client";

/**
 * /admin/coord/subprojects/[id] — one subproject: why it is where it is, what
 * happens next, and every session, gate, work unit and PR that belongs to it.
 *
 * Plan `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6 (D12). coord computes the verdict LIVE on this read (D1); the page
 * words it and adds nothing to it. In the order a record's detail uses
 * (style guide R5 — why → what failed → actions → history → raw ids):
 *
 * 1. **Why** — the headline and every reason, each reference linked where it
 *    lives (sessions to `/sessions/<id>`, PRs to GitHub, gates to the Gates
 *    page, work units to their page, other subprojects to theirs), and every
 *    source the verdict could not read, named.
 * 2. **Next steps** — coord's list, each with where it came from (D7).
 * 3. **Actions** — Continue…, Rename…, Goal…, Next-steps note…, Mark done /
 *    Reopen, Merge into…, Move… (coord tenant admin; D8, D11).
 * 4. **Sessions** (open AND closed), **Gates** (open first, each with its
 *    mover), **Plans & PRs**, **History** — `RecordList`s of one-line rows
 *    that expand in place.
 * 5. **Raw ids** last, in the console's raw-line type.
 *
 * Reads: `useSubprojectDetail` — a 404 is coord's answer ("no such
 * subproject") and is said as one; a read that did not answer keeps the last
 * good record and dates it, or, with none, renders UNKNOWN with the reason
 * (R6). Nothing here is presentation-ready, so the lens withholds the page.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BackendErrorMessage,
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatusBadge,
  rowAccentProps,
} from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import {
  PLAN_STATUS_PALETTE,
  derivePlanStatus,
} from "@/components/admin/coord/planStatus";
import { operationsErrorReading } from "@/lib/api/operations/base";
import type { BackendErrorReading } from "@/lib/errors/backend-error-message";
import {
  updateSubproject,
  type SubprojectDetailResponse,
  type SubprojectHistoryEntry,
  type SubprojectMemberGate,
  type SubprojectMemberPr,
  type SubprojectMemberSession,
  type SubprojectMemberUnit,
} from "@/lib/api/operations/coordSubprojects";
import {
  SUBPROJECT_GATE_PALETTE,
  SUBPROJECT_HEADLINE_PALETTE,
  SUBPROJECT_SESSION_PALETTE,
  defaultContinueRepos,
  deriveMemberGateStatus,
  deriveMemberSessionStatus,
  deriveVerdictStatus,
  gateAttributionWords,
  historyEventWords,
  gateVerdictWords,
  joinedViaWords,
  memberEmptyText,
  memberList,
  memberSessionKey,
  nextStepWords,
  otherSubprojectOf,
  phasesRemainingWords,
  predicateKindWords,
  prHref,
  prStateWords,
  projectStateWords,
  readFailureWords,
  reasonWords,
  sessionWorkWords,
  sessionsText,
  sessionsTitle,
  sortMemberGates,
  sortMemberSessions,
  sourceStateWords,
  unreadSources,
  type RefContext,
} from "@/components/admin/coord/subprojects/subprojectStatus";
import { RefLink, RefList } from "@/components/admin/coord/subprojects/RefLink";
import { ContinueDialog } from "@/components/admin/coord/subprojects/ContinueDialog";
import {
  MergeDialog,
  MoveDialog,
  SubprojectTextDialog,
  type MemberPreset,
  type TextField,
} from "@/components/admin/coord/subprojects/SubprojectDialogs";
import { useSubprojectDetail } from "./_hooks/useSubprojectDetail";

type OpenDialog =
  | { kind: "continue" }
  | { kind: "text"; field: TextField }
  | { kind: "merge" }
  | { kind: "move"; preset: MemberPreset | null }
  | null;

const SECTION_HEADING =
  "m-0 text-sm font-semibold text-muted-foreground uppercase tracking-wider";

export default function SubprojectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = useMemo(() => {
    const raw = params?.id;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);
  const state = useSubprojectDetail(id);
  const { detail } = state;
  const [dialog, setDialog] = useState<OpenDialog>(null);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-5xl mx-auto overflow-x-auto"
      data-testid="coord-subproject-detail-page"
      data-ui-bridge-id="coord-subproject-detail"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/coord/subprojects")}
          data-testid="coord-subproject-back"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Subprojects
        </Button>
        <span className="text-muted-foreground">/</span>
        <span
          className="min-w-0 truncate text-sm"
          title={detail?.subproject.title ?? id}
        >
          {detail?.subproject.title ?? id}
        </span>
        <RefreshButton
          className="ml-auto"
          onRefresh={state.refresh}
          label="Re-read this subproject"
          title="coord recomputes the verdict on every read; the page also re-reads itself every minute."
          data-testid="coord-subproject-refresh"
        />
      </div>

      <ReadState state={state} id={id} />

      {detail !== null && (
        <SubprojectBody
          detail={detail}
          onOpen={setDialog}
          onChanged={() => void state.refresh()}
        />
      )}

      {/* Each dialog is MOUNTED only while it is open: it starts from the
          record as read at that moment, and the minute re-read never resets
          a field under an operator who is typing in it. */}
      {detail !== null && dialog?.kind === "continue" && (
        <ContinueDialog
          open
          onClose={() => setDialog(null)}
          subprojectId={detail.subproject.id}
          subprojectTitle={detail.subproject.title}
          suggestedRepos={defaultContinueRepos(detail.prs ?? [])}
          nextSteps={detail.next_steps ?? null}
          onContinued={() => void state.refresh()}
        />
      )}
      {detail !== null && dialog?.kind === "text" && (
        <SubprojectTextDialog
          open
          onClose={() => setDialog(null)}
          field={dialog.field}
          subprojectId={detail.subproject.id}
          initial={detail.subproject[dialog.field] ?? ""}
          onSaved={() => void state.refresh()}
        />
      )}
      {detail !== null && dialog?.kind === "merge" && (
        <MergeDialog
          open
          onClose={() => setDialog(null)}
          subproject={detail.subproject}
          onMerged={(intoId) =>
            router.push(
              `/admin/coord/subprojects/${encodeURIComponent(intoId)}`
            )
          }
        />
      )}
      {detail !== null && dialog?.kind === "move" && (
        <MoveDialog
          open
          onClose={() => setDialog(null)}
          subproject={detail.subproject}
          preset={dialog.preset}
          onMoved={() => void state.refresh()}
        />
      )}
    </div>
  );
}

/** What the read said, before any record: loading, absent, unknown, stale. */
function ReadState({
  state,
  id,
}: {
  state: ReturnType<typeof useSubprojectDetail>;
  id: string;
}) {
  if (!state.loaded && state.failure === null) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (state.absence !== null) {
    return (
      <div className="space-y-1">
        <p
          className="m-0 text-sm text-muted-foreground"
          data-testid="coord-subproject-not-found"
        >
          {state.absence === "invalid_id"
            ? `"${id}" is not a subproject id.`
            : `coord has no subproject ${id} in this project. It may have been archived, or the link is wrong.`}{" "}
          <Link
            href="/admin/coord/subprojects"
            className="underline underline-offset-2"
          >
            All subprojects
          </Link>
        </p>
        {/* coord's "none" was an answer — at the read that gave it. A later
            re-read that failed did not repeat it, so it is dated, not
            restated as current (R6). An invalid id stays invalid. */}
        {state.failure && state.absence === "not_found" ? (
          <p
            className="m-0 text-xs text-amber-200"
            role="status"
            data-testid="coord-subproject-not-found-stale"
          >
            That was coord&apos;s answer at the last read that answered
            {state.readAt ? (
              <>
                {" "}
                (<RowTime at={state.readAt} verb="Read" />)
              </>
            ) : null}
            ; the latest re-read failed — {readFailureWords(state.failure)} — so
            whether it exists now is unknown.
          </p>
        ) : null}
      </div>
    );
  }
  if (state.failure && !state.detail) {
    return (
      <p
        className="m-0 text-sm text-amber-200"
        role="status"
        data-testid="coord-subproject-unknown"
      >
        This subproject could not be read: {readFailureWords(state.failure)}.
        Whether it exists, and where it stands, is unknown.
      </p>
    );
  }
  if (state.stale && state.failure) {
    return (
      <p
        className="m-0 text-xs text-amber-200"
        role="status"
        data-testid="coord-subproject-stale"
      >
        The latest read failed — {readFailureWords(state.failure)}. Everything
        below is the last good read
        {state.readAt ? (
          <>
            {" "}
            (<RowTime at={state.readAt} verb="Read" />)
          </>
        ) : null}
        , not a current one.
      </p>
    );
  }
  return null;
}

function SubprojectBody({
  detail,
  onOpen,
  onChanged,
}: {
  detail: SubprojectDetailResponse;
  onOpen: (d: OpenDialog) => void;
  onChanged: () => void;
}) {
  const s = detail.subproject;
  const status = deriveVerdictStatus(detail.verdict ?? null);
  const context: RefContext = { units: detail.work_units, prs: detail.prs };
  const unread = unreadSources(detail.verdict?.sources ?? []);
  const sessionList = memberList(detail.sessions);
  const gateList = memberList(detail.gates);
  const unitList = memberList(detail.work_units);
  const prList = memberList(detail.prs);
  const historyList = memberList(detail.history);
  const stepList = memberList(detail.next_steps);
  const sessions = sortMemberSessions(sessionList.items);
  const gates = sortMemberGates(gateList.items);
  const openGates = gates.filter(
    (g) => deriveMemberGateStatus(g).kind !== "closed"
  ).length;

  return (
    <>
      {/* The subproject's line: the same badge and left-edge accent its list
          row carries, but from the LIVE verdict. */}
      <div
        data-testid="coord-subproject-header"
        {...rowAccentProps(
          status,
          "rounded-lg border border-border bg-card/30 px-4 py-3 space-y-1.5"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium min-w-0 break-words">
            {s.title || s.slug}
          </span>
          <StatusBadge status={status} palette={SUBPROJECT_HEADLINE_PALETTE} />
          <span className="font-mono text-xs" title={sessionsTitle(s.sessions)}>
            {sessionsText(s.sessions)} sessions live
          </span>
          <RowTime
            at={detail.verdict?.as_of}
            verb="Verdict computed"
            prefix="verdict "
            absent={{
              label: "no verdict",
              title: "coord served no verdict on this read.",
            }}
          />
          {s.status !== "open" && (
            <span
              className="text-xs text-muted-foreground"
              data-testid="coord-subproject-declared"
            >
              marked {s.status}
              {s.closed_at ? (
                <>
                  {" "}
                  <RowTime at={s.closed_at} verb="Closed" />
                </>
              ) : null}
            </span>
          )}
        </div>
        {s.goal ? (
          <p
            className="m-0 text-sm text-foreground/85"
            data-testid="coord-subproject-goal"
          >
            Goal: {s.goal}
          </p>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">No goal set.</p>
        )}
        {detail.resolved_from && (
          <p
            className="m-0 text-xs text-muted-foreground"
            data-testid="coord-subproject-resolved-from"
          >
            The subproject you opened ({detail.resolved_from}) was merged into
            this one.
          </p>
        )}
      </div>

      {/* 1 — why, and what could not be read. */}
      <section className="space-y-2" data-testid="coord-subproject-why">
        <h2 className={SECTION_HEADING}>Why</h2>
        <p className="m-0 text-[13px] text-foreground/85">
          {status.label}
          {status.reason ? ` — ${status.reason}` : ""}
        </p>
        {(detail.verdict?.reasons ?? []).length > 0 ? (
          <ul
            className="m-0 space-y-1.5 pl-4 list-disc text-sm"
            data-testid="coord-subproject-reasons"
          >
            {detail.verdict.reasons.map((r, i) => {
              const words = reasonWords(r.kind);
              // A cause in ANOTHER subproject (D6): its headline beside the
              // ref, so the operator sees where the stall actually is.
              const other = otherSubprojectOf(r);
              return (
                <li key={`${r.kind}:${i}`} data-reason-kind={r.kind}>
                  <span
                    className="font-medium"
                    title={words.recognised ? r.kind : undefined}
                  >
                    {words.label}
                  </span>
                  {r.summary ? (
                    <span className="text-foreground/85"> — {r.summary}</span>
                  ) : null}
                  {r.refs.length > 0 && (
                    <>
                      {" "}
                      <RefList
                        refs={r.refs}
                        context={context}
                        annotate={(ref) =>
                          other !== null &&
                          ref.type === "subproject" &&
                          ref.id === other.id ? (
                            <span data-testid="coord-subproject-other-headline">
                              <StatusBadge
                                status={other.status}
                                palette={SUBPROJECT_HEADLINE_PALETTE}
                              />
                            </span>
                          ) : null
                        }
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">
            coord gave no reasons with this verdict.
          </p>
        )}
        {unread.length > 0 && (
          <div
            className="space-y-1"
            data-testid="coord-subproject-unread-sources"
          >
            <p className="m-0 text-xs font-medium text-amber-200">
              The verdict rests on evidence coord could not read:
            </p>
            <ul className="m-0 pl-4 list-disc text-xs text-muted-foreground">
              {unread.map((src) => (
                <li key={src.source}>
                  {src.source.replace(/_/g, " ")} {sourceStateWords(src.state)}
                  {src.error ? ` — ${src.error}` : ""}
                  {src.as_of ? (
                    <>
                      {" "}
                      (<RowTime at={src.as_of} verb="As of" />)
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 2 — what happens next. */}
      <section className="space-y-2" data-testid="coord-subproject-next-steps">
        <h2 className={SECTION_HEADING}>Next steps</h2>
        {stepList.items.length > 0 ? (
          <ol className="m-0 space-y-1.5 pl-4 list-decimal text-sm">
            {stepList.items.map((step, i) => {
              const words = nextStepWords(step);
              return (
                <li
                  key={`${step.source}:${i}`}
                  data-next-step-source={step.source}
                >
                  <span className="text-xs text-muted-foreground">
                    {words.source}:{" "}
                  </span>
                  {words.remedy && (
                    <span className="font-medium">{words.remedy} — </span>
                  )}
                  <span className="text-foreground/85">{step.text}</span>
                  {step.source === "note" && s.next_steps_note_by ? (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      (by {s.next_steps_note_by}
                      {s.next_steps_note_at ? (
                        <>
                          , <RowTime at={s.next_steps_note_at} verb="Written" />
                        </>
                      ) : null}
                      )
                    </span>
                  ) : null}
                  {step.refs.length > 0 && (
                    <>
                      {" "}
                      <RefList refs={step.refs} context={context} />
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p
            className="m-0 text-xs text-muted-foreground"
            data-testid="coord-subproject-next-steps-empty"
          >
            {memberEmptyText("next step", stepList.known, unread, "next steps")}
          </p>
        )}
      </section>

      {/* 3 — the operator's levers. */}
      <section className="space-y-2" data-testid="coord-subproject-actions">
        <h2 className={SECTION_HEADING}>Actions</h2>
        <CoordAdminOnly
          fallback={
            <ReadOnlyNotice label="Continuing and editing a subproject are administrator only." />
          }
        >
          <SubprojectActions
            detail={detail}
            onOpen={onOpen}
            onChanged={onChanged}
          />
        </CoordAdminOnly>
      </section>

      {/* 4 — the members. */}
      <section className="space-y-2" data-testid="coord-subproject-sessions">
        <h2 className={SECTION_HEADING}>
          Sessions{" "}
          <span className="font-mono normal-case">
            {sessionList.known ? sessions.length : "–"}
          </span>
        </h2>
        <RecordList<SubprojectMemberSession>
          items={sessions}
          itemKey={(m, i) =>
            m.agent_session_id ??
            m.coord_session_id ??
            m.allocation_agent_id ??
            `session-${i}`
          }
          empty={
            <p className="m-0 text-xs text-muted-foreground">
              {memberEmptyText("member session", sessionList.known, unread)}
            </p>
          }
          renderRow={(m, ctx) => (
            <SessionRow
              member={m}
              {...ctx}
              onMove={(preset) => onOpen({ kind: "move", preset })}
            />
          )}
        />
      </section>

      <section className="space-y-2" data-testid="coord-subproject-gates">
        <h2 className={SECTION_HEADING}>
          Gates{" "}
          <span className="font-mono normal-case">
            {gateList.known ? `${openGates} open of ${gates.length}` : "–"}
          </span>
        </h2>
        <RecordList<SubprojectMemberGate>
          items={gates}
          itemKey={(g) => g.gate_id}
          empty={
            <p className="m-0 text-xs text-muted-foreground">
              {memberEmptyText("member gate", gateList.known, unread)}
            </p>
          }
          renderRow={(g, ctx) => <GateRow gate={g} {...ctx} />}
        />
      </section>

      <section className="space-y-2" data-testid="coord-subproject-plans-prs">
        <h2 className={SECTION_HEADING}>Plans &amp; PRs</h2>
        <RecordList<SubprojectMemberUnit>
          items={unitList.items}
          itemKey={(u) => u.work_unit_id}
          empty={
            <p className="m-0 text-xs text-muted-foreground">
              {memberEmptyText("member work unit", unitList.known, unread)}
            </p>
          }
          renderRow={(u, ctx) => (
            <UnitRow
              unit={u}
              {...ctx}
              onMove={(preset) => onOpen({ kind: "move", preset })}
            />
          )}
        />
        <RecordList<SubprojectMemberPr>
          items={prList.items}
          itemKey={(p) => `${p.repo}#${p.number}`}
          empty={
            <p className="m-0 text-xs text-muted-foreground">
              {memberEmptyText("pull request", prList.known, unread)}
            </p>
          }
          renderRow={(p, ctx) => <PrRow pr={p} {...ctx} />}
        />
      </section>

      {/* 5 — history, collapsed by default (R7). */}
      <CollapsiblePanel
        title="History"
        summary={
          <span className="font-mono text-xs text-muted-foreground">
            {historyList.known ? historyList.items.length : "–"}
          </span>
        }
        storageKey="coord-subproject-history"
        defaultOpen={false}
        data-testid="coord-subproject-history"
      >
        <RecordList<SubprojectHistoryEntry>
          items={historyList.items}
          itemKey={(h, i) => `${h.at}:${h.event}:${i}`}
          empty={
            <p className="m-0 text-xs text-muted-foreground">
              {historyList.known
                ? "coord recorded no history."
                : "coord did not send the history with this read — unknown, not none."}
            </p>
          }
          renderRow={(h, ctx) => <HistoryRow entry={h} {...ctx} />}
        />
      </CollapsiblePanel>

      <p
        className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all"
        data-testid="coord-subproject-raw"
      >
        id {s.id} · slug {s.slug} · origin {s.origin} · title from{" "}
        {s.title_source} · status {s.status}
        {s.root_agent_session_id
          ? ` · root session ${s.root_agent_session_id}`
          : ""}
        {s.merged_into ? ` · merged into ${s.merged_into}` : ""}
        {detail.resolved_from ? ` · resolved from ${detail.resolved_from}` : ""}
      </p>
    </>
  );
}

function SubprojectActions({
  detail,
  onOpen,
  onChanged,
}: {
  detail: SubprojectDetailResponse;
  onOpen: (d: OpenDialog) => void;
  onChanged: () => void;
}) {
  const s = detail.subproject;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BackendErrorReading | null>(null);
  // Done and archived are both closed: the lever reopens either, and never
  // offers to mark an archived subproject done.
  const done = s.status === "done" || s.status === "archived";

  const setDone = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateSubproject(s.id, { status: done ? "open" : "done" });
      toast.success(done ? "Reopened" : "Marked done");
      onChanged();
    } catch (err) {
      setError(operationsErrorReading(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => onOpen({ kind: "continue" })}
          data-testid="coord-subproject-continue"
        >
          Continue…
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen({ kind: "text", field: "title" })}
          data-testid="coord-subproject-rename"
        >
          Rename…
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen({ kind: "text", field: "goal" })}
          data-testid="coord-subproject-goal-action"
        >
          Goal…
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen({ kind: "text", field: "next_steps_note" })}
          data-testid="coord-subproject-note-action"
        >
          Next-steps note…
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void setDone()}
          disabled={busy}
          data-testid="coord-subproject-done-toggle"
        >
          {busy ? "Saving…" : done ? "Reopen" : "Mark done"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen({ kind: "merge" })}
          data-testid="coord-subproject-merge"
        >
          Merge into…
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen({ kind: "move", preset: null })}
          data-testid="coord-subproject-move"
        >
          Move…
        </Button>
      </div>
      {error && (
        <BackendErrorMessage
          error={error}
          data-testid="coord-subproject-done-error"
        />
      )}
    </div>
  );
}

function SessionRow({
  member,
  expanded,
  onToggle,
  rowKey,
  onMove,
}: {
  member: SubprojectMemberSession;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
  onMove: (preset: MemberPreset) => void;
}) {
  const status = deriveMemberSessionStatus(member);
  const key = memberSessionKey(member);
  // Words on the line; the ids are on the raw line (R8).
  const name =
    member.name ??
    (member.pending
      ? "A session Continue spawned, not reported yet"
      : "A session with no name");
  return (
    <RecordRow
      rowKey={rowKey}
      identity={member.device_name ?? "device unknown"}
      label={<span title={name}>{name}</span>}
      status={
        <StatusBadge status={status} palette={SUBPROJECT_SESSION_PALETTE} />
      }
      reason={`${status.reason ?? ""} · ${joinedViaWords(member.joined_via)}`}
      attention={status.attention}
      time={
        <RowTime
          at={member.last_seen}
          verb="Last seen"
          absent={{
            label: "never seen",
            title: "coord has no last-seen time for this session.",
          }}
        />
      }
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-subproject-session-row"
    >
      <RecordDetail
        why={
          <p className="m-0 text-[13px] text-foreground/85">
            {status.label}: {sessionWorkWords(member.session_status)}
            {member.finish_reason ? ` — ${member.finish_reason}` : ""}. Joined
            as {joinedViaWords(member.joined_via)}
            {member.joined_via === "gate_continuation" && member.via_ref ? (
              <>
                {" "}
                —{" "}
                <RefLink
                  subjectRef={{
                    type: "gate",
                    id: member.via_ref,
                    label: "its gate",
                  }}
                />
              </>
            ) : null}
            .
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {key ? (
              <Link
                href={`/sessions/${encodeURIComponent(key)}`}
                className="underline underline-offset-2"
              >
                Open session ↗
              </Link>
            ) : (
              <span className="text-muted-foreground">
                No session id yet — the runner has not reported this spawn.
              </span>
            )}
            {member.agent_session_id && (
              <CoordAdminOnly>
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() =>
                    onMove({
                      kind: "session",
                      id: member.agent_session_id ?? "",
                      label: name,
                    })
                  }
                  data-testid="coord-subproject-session-move"
                >
                  Move or remove…
                </button>
              </CoordAdminOnly>
            )}
          </div>
        }
        history={
          <p className="m-0 text-xs text-muted-foreground">
            First seen{" "}
            <RowTime
              at={member.first_seen}
              verb="First seen"
              absent={{ label: "unknown", title: "Not reported." }}
            />{" "}
            · last seen{" "}
            <RowTime
              at={member.last_seen}
              verb="Last seen"
              absent={{ label: "unknown", title: "Not reported." }}
            />
            {member.closed_at ? (
              <>
                {" "}
                · closed <RowTime at={member.closed_at} verb="Closed" />
              </>
            ) : null}{" "}
            · joined <RowTime at={member.added_at} verb="Joined" />
          </p>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            harness {member.agent_session_id ?? "—"} · coord session{" "}
            {member.coord_session_id ?? "—"} · allocation{" "}
            {member.allocation_agent_id ?? "—"} · device{" "}
            {member.device_id ?? "—"} · liveness {member.liveness} · joined_via{" "}
            {member.joined_via} · via_ref {member.via_ref ?? "—"}
          </p>
        }
      />
    </RecordRow>
  );
}

function GateRow({
  gate,
  expanded,
  onToggle,
  rowKey,
}: {
  gate: SubprojectMemberGate;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
}) {
  const status = deriveMemberGateStatus(gate);
  return (
    <RecordRow
      rowKey={rowKey}
      identity={predicateKindWords(gate.predicate_kind)}
      label={
        <span title={gate.phase_name ?? undefined}>
          {gate.phase_name ?? "Gate with no phase name"}
        </span>
      }
      status={<StatusBadge status={status} palette={SUBPROJECT_GATE_PALETTE} />}
      reason={status.reason}
      attention={status.attention}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-subproject-gate-row"
    >
      <RecordDetail
        why={
          <p className="m-0 text-[13px] text-foreground/85">
            {status.label}
            {gate.mover.summary ? ` — ${gate.mover.summary}` : ""}. Verdict:{" "}
            {gateVerdictWords(gate.verdict)}.
          </p>
        }
        problems={
          <p className="m-0 text-xs text-muted-foreground">
            {gateAttributionWords(gate.attribution)}
            {gate.continuation_state
              ? ` · continuation ${gate.continuation_state.replace(/_/g, " ")}`
              : " · no continuation state served"}
          </p>
        }
        actions={
          <Link
            href={`/admin/coord/gates?gate=${encodeURIComponent(gate.gate_id)}`}
            className="text-xs underline underline-offset-2"
          >
            Open in Gates ↗
          </Link>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            gate {gate.gate_id} · predicate {gate.predicate_kind} · verdict{" "}
            {gate.verdict} · mover {gate.mover.state}
            {gate.registered_by_session
              ? ` · registered by ${gate.registered_by_session}`
              : ""}
          </p>
        }
      />
    </RecordRow>
  );
}

function UnitRow({
  unit,
  expanded,
  onToggle,
  rowKey,
  onMove,
}: {
  unit: SubprojectMemberUnit;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
  onMove: (preset: MemberPreset) => void;
}) {
  const status = derivePlanStatus({ status: unit.status, current_phase: null });
  const label = unit.title || unit.slug;
  return (
    <RecordRow
      rowKey={rowKey}
      identity="unit"
      label={<span title={label}>{label}</span>}
      status={<StatusBadge status={status} palette={PLAN_STATUS_PALETTE} />}
      reason={`${projectStateWords(unit.project_state_class)} · ${phasesRemainingWords(unit.phases_remaining)}`}
      attention={status.attention}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-subproject-unit-row"
    >
      <RecordDetail
        why={
          <p className="m-0 text-[13px] text-foreground/85">
            {status.label}; {projectStateWords(unit.project_state_class)};{" "}
            {phasesRemainingWords(unit.phases_remaining)}. Joined as{" "}
            {joinedViaWords(unit.joined_via)}.
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Link
              href={`/admin/coord/work-units/${encodeURIComponent(unit.slug)}`}
              className="underline underline-offset-2"
            >
              Open work unit ↗
            </Link>
            <CoordAdminOnly>
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() =>
                  onMove({ kind: "work_unit", id: unit.work_unit_id, label })
                }
                data-testid="coord-subproject-unit-move"
              >
                Move or remove…
              </button>
            </CoordAdminOnly>
          </div>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            work unit {unit.work_unit_id} · slug {unit.slug} · status{" "}
            {unit.status}
          </p>
        }
      />
    </RecordRow>
  );
}

function PrRow({
  pr,
  expanded,
  onToggle,
  rowKey,
}: {
  pr: SubprojectMemberPr;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
}) {
  const href = prHref(pr);
  return (
    <RecordRow
      rowKey={rowKey}
      identity={`#${pr.number}`}
      label={<span title={`${pr.repo}#${pr.number}`}>{pr.repo}</span>}
      reason={prStateWords(pr.state)}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-subproject-pr-row"
    >
      <RecordDetail
        actions={
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline underline-offset-2"
            >
              Open on GitHub ↗
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">
              coord sent no address for this PR.
            </span>
          )
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            {pr.repo}#{pr.number} · state {pr.state ?? "—"}
            {pr.author_agent_session_id
              ? ` · author session ${pr.author_agent_session_id}`
              : ""}
          </p>
        }
      />
    </RecordRow>
  );
}

function HistoryRow({
  entry,
  expanded,
  onToggle,
  rowKey,
}: {
  entry: SubprojectHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
}) {
  const detailText =
    entry.detail === null || entry.detail === undefined
      ? null
      : typeof entry.detail === "string"
        ? entry.detail
        : JSON.stringify(entry.detail);
  return (
    <RecordRow
      rowKey={rowKey}
      identity="event"
      label={historyEventWords(entry.event)}
      time={<RowTime at={entry.at} verb="At" />}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-subproject-history-row"
    >
      <RecordDetail
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            {entry.event} · {entry.at}
            {detailText ? ` · ${detailText}` : ""}
          </p>
        }
      />
    </RecordRow>
  );
}
