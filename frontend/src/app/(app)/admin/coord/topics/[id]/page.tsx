"use client";

/**
 * /admin/coord/topics/[id] — one topic: what it is for, what happens next, and
 * which subprojects belong to it and why.
 *
 * Plan `2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator`
 * Phase 8 (D9). In the order a record's detail uses (style guide R5):
 *
 * 1. The topic's line — its cached rollup badge, working/total, as-of — then
 *    its **summary**.
 * 2. **Next steps** — coord's text, or "none recorded".
 * 3. **Subprojects** — one row per member, confirmed first: its own headline,
 *    the membership's weight and state, and on expansion its basis as plain
 *    sentences ("shares plan `<ref>`", "tagged by session X", "could not read
 *    <family>") with who decided it.
 * 4. **Child topics**, then **History** (collapsed; coord may keep none).
 * 5. Raw ids last.
 *
 * Read-only: the operator write doors exist on coord but no control here
 * calls them yet.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  RefreshButton,
  RowTime,
  StatusBadge,
  rowAccentProps,
} from "@/components/console";
import { memberList } from "@/components/admin/coord/subprojects/subprojectStatus";
import {
  TOPIC_HEADLINE_PALETTE,
  basisSentence,
  basisTitle,
  decidedByWords,
  deriveMemberHeadline,
  deriveTopicStatus,
  memberStateWords,
  sortMembers,
  topicReadFailureWords,
  weightText,
  workingText,
  workingTitle,
} from "@/components/admin/coord/topics/topicStatus";
import type {
  TopicChild,
  TopicDetailResponse,
  TopicHistoryEntry,
  TopicMember,
} from "@/lib/api/operations/coordTopics";
import { useTopicDetail } from "./_hooks/useTopicDetail";

const SECTION_HEADING =
  "m-0 text-sm font-semibold text-muted-foreground uppercase tracking-wider";

export default function TopicDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = useMemo(() => {
    const raw = params?.id;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);
  const state = useTopicDetail(id);
  const { detail } = state;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-5xl mx-auto overflow-x-auto"
      data-testid="coord-topic-detail-page"
      data-ui-bridge-id="coord-topic-detail"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/coord/topics")}
          data-testid="coord-topic-back"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Topics
        </Button>
        <span className="text-muted-foreground">/</span>
        <span
          className="min-w-0 truncate text-sm"
          title={detail?.topic.title ?? id}
        >
          {detail?.topic.title ?? id}
        </span>
        <RefreshButton
          className="ml-auto"
          onRefresh={state.refresh}
          label="Re-read this topic"
          title="The page also re-reads itself every minute."
          data-testid="coord-topic-refresh"
        />
      </div>

      <ReadState state={state} id={id} />

      {detail !== null && <TopicBody detail={detail} />}
    </div>
  );
}

function ReadState({
  state,
  id,
}: {
  state: ReturnType<typeof useTopicDetail>;
  id: string;
}) {
  if (!state.loaded && state.failure === null) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (state.absence !== null) {
    return (
      <p
        className="m-0 text-sm text-muted-foreground"
        data-testid="coord-topic-not-found"
      >
        {state.absence === "invalid_id"
          ? `"${id}" is not a topic id.`
          : `coord has no topic ${id} in this project. It may have been merged or retired, or the link is wrong.`}{" "}
        <Link
          href="/admin/coord/topics"
          className="underline underline-offset-2"
        >
          All topics
        </Link>
        {state.failure && state.absence === "not_found"
          ? ` That was coord's answer at the last read that answered; the latest re-read failed — ${topicReadFailureWords(state.failure)}.`
          : null}
      </p>
    );
  }
  if (state.failure && !state.detail) {
    return (
      <p
        className="m-0 text-sm text-amber-200"
        role="status"
        data-testid="coord-topic-unknown"
      >
        This topic could not be read: {topicReadFailureWords(state.failure)}.
        Whether it exists, and where it stands, is unknown.
      </p>
    );
  }
  if (state.stale && state.failure) {
    return (
      <p
        className="m-0 text-xs text-amber-200"
        role="status"
        data-testid="coord-topic-stale"
      >
        The latest read failed — {topicReadFailureWords(state.failure)}.
        Everything below is the last good read
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

function TopicBody({ detail }: { detail: TopicDetailResponse }) {
  const t = detail.topic;
  const status = deriveTopicStatus(t);
  const memberRead = memberList(detail.members);
  const childList = memberList(detail.children);
  const historyList = memberList(detail.history);
  const members = sortMembers(memberRead.items);

  return (
    <>
      <div
        data-testid="coord-topic-header"
        {...rowAccentProps(
          status,
          "rounded-lg border border-border bg-card/30 px-4 py-3 space-y-1.5"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium min-w-0 break-words">
            {t.title || t.slug}
          </span>
          <StatusBadge status={status} palette={TOPIC_HEADLINE_PALETTE} />
          <span className="font-mono text-xs" title={workingTitle(t)}>
            {workingText(t)} subprojects working
          </span>
          <RowTime
            at={t.last_rollup_as_of}
            verb="Rolled up"
            prefix="rollup "
            absent={{
              label: "no rollup",
              title: "coord has not rolled this topic up yet.",
            }}
          />
          {t.status !== "active" && (
            <span
              className="text-xs text-muted-foreground"
              data-testid="coord-topic-declared"
            >
              {t.status}
            </span>
          )}
        </div>
        {status.reason ? (
          <p className="m-0 text-[13px] text-foreground/85">{status.reason}</p>
        ) : null}
        {t.summary ? (
          <p
            className="m-0 text-sm text-foreground/85"
            data-testid="coord-topic-summary"
          >
            {t.summary}
          </p>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">No summary yet.</p>
        )}
        {t.merged_into && (
          <p className="m-0 text-xs text-muted-foreground">
            Merged into{" "}
            <Link
              href={`/admin/coord/topics/${encodeURIComponent(t.merged_into)}`}
              className="underline underline-offset-2"
            >
              another topic
            </Link>
            .
          </p>
        )}
      </div>

      <section className="space-y-2" data-testid="coord-topic-next-steps">
        <h2 className={SECTION_HEADING}>Next steps</h2>
        <p className="m-0 text-sm text-foreground/85 whitespace-pre-wrap">
          {t.next_steps ? (
            t.next_steps
          ) : (
            <span className="text-xs text-muted-foreground">
              No next steps recorded for this topic.
            </span>
          )}
        </p>
      </section>

      <section className="space-y-2" data-testid="coord-topic-members">
        <h2 className={SECTION_HEADING}>
          Subprojects{" "}
          <span className="font-mono">
            {memberRead.known ? memberRead.items.length : "–"}
          </span>
        </h2>
        <RecordList<TopicMember>
          items={members}
          itemKey={(m) => m.subproject_id}
          empty={
            <p className="m-0 text-xs text-muted-foreground">
              {memberRead.known
                ? "No subproject belongs to this topic yet."
                : "coord did not send the members with this read — unknown, not none."}
            </p>
          }
          renderRow={(m, ctx) => <MemberRow m={m} {...ctx} />}
        />
      </section>

      <section className="space-y-2" data-testid="coord-topic-children">
        <h2 className={SECTION_HEADING}>Child topics</h2>
        {childList.items.length > 0 ? (
          <ul className="m-0 pl-4 text-sm space-y-0.5">
            {childList.items.map((c: TopicChild) => (
              <li key={c.id}>
                <Link
                  href={`/admin/coord/topics/${encodeURIComponent(c.id)}`}
                  className="underline underline-offset-2"
                >
                  {c.title || c.slug}
                </Link>{" "}
                <span className="text-xs text-muted-foreground">
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">
            {childList.known
              ? "No child topics."
              : "coord did not send child topics with this read — unknown, not none."}
          </p>
        )}
      </section>

      <CollapsiblePanel
        title="History"
        summary={
          <span className="font-mono text-xs text-muted-foreground">
            {historyList.known ? historyList.items.length : "–"}
          </span>
        }
        storageKey="coord-topic-history"
        defaultOpen={false}
        data-testid="coord-topic-history"
      >
        <RecordList<TopicHistoryEntry>
          items={historyList.items}
          itemKey={(h, i) => `${h.at}:${h.action}:${i}`}
          empty={
            <p className="m-0 text-xs text-muted-foreground">
              {historyList.known
                ? "coord recorded no history for this topic (it may not keep topic history yet)."
                : "coord did not send the history with this read — unknown, not none."}
            </p>
          }
          renderRow={(h, ctx) => <HistoryRow entry={h} {...ctx} />}
        />
      </CollapsiblePanel>

      <p
        className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all"
        data-testid="coord-topic-raw"
      >
        id {t.id} · slug {t.slug} · status {t.status} · created by{" "}
        {t.created_by}
        {t.aliases && t.aliases.length > 0
          ? ` · aliases ${t.aliases.join(", ")}`
          : ""}
        {t.parent_topic_id ? ` · parent ${t.parent_topic_id}` : ""}
        {t.merged_into ? ` · merged into ${t.merged_into}` : ""} · read as of{" "}
        {detail.as_of}
      </p>
    </>
  );
}

function MemberRow({
  m,
  expanded,
  onToggle,
  rowKey,
}: {
  m: TopicMember;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
}) {
  const headline = deriveMemberHeadline(m);
  const title = m.subproject_title ?? m.subproject_id;
  const basis = m.basis ?? null;
  return (
    <RecordRow
      rowKey={rowKey}
      identity={
        <span
          title={`weight ${weightText(m.weight)}, ${memberStateWords(m.state)}`}
          data-testid="coord-topic-member-weight"
        >
          {weightText(m.weight)} · {memberStateWords(m.state)}
        </span>
      }
      label={<span title={title}>{title}</span>}
      status={
        <StatusBadge status={headline} palette={TOPIC_HEADLINE_PALETTE} />
      }
      reason={headline.reason}
      attention={headline.attention}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-topic-member-row"
    >
      <RecordDetail
        why={
          <>
            <p className="m-0 text-xs text-muted-foreground">
              {memberStateWords(m.state)} by {decidedByWords(m.decided_by)}
              {m.decided_by_session ? ` (session ${m.decided_by_session})` : ""}
              .
            </p>
            {basis === null ? (
              <p className="m-0 text-xs text-muted-foreground">
                coord did not send why — unknown, not none.
              </p>
            ) : basis.length === 0 ? (
              <p className="m-0 text-xs text-muted-foreground">
                No evidence recorded for this membership.
              </p>
            ) : (
              <ul
                className="m-0 pl-4 text-[13px] text-foreground/85 space-y-0.5"
                data-testid="coord-topic-member-basis"
              >
                {basis.map((b, i) => (
                  <li key={`${b.signal}:${b.ref}:${i}`} title={basisTitle(b)}>
                    {basisSentence(b)}
                  </li>
                ))}
              </ul>
            )}
          </>
        }
        actions={
          <Link
            href={`/admin/coord/subprojects/${encodeURIComponent(m.subproject_id)}`}
            className="text-xs underline underline-offset-2 hover:text-foreground"
            data-testid="coord-topic-member-open"
          >
            Open subproject ↗
          </Link>
        }
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            subproject {m.subproject_id} · state {m.state} · weight{" "}
            {m.weight ?? "null"} · decided by {m.decided_by}
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
  entry: TopicHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  rowKey: string;
}) {
  return (
    <RecordRow
      rowKey={rowKey}
      identity={entry.by}
      label={entry.action.replace(/_/g, " ")}
      reason={entry.reason ?? undefined}
      time={<RowTime at={entry.at} verb="At" />}
      expanded={expanded}
      onToggle={onToggle}
      data-testid="coord-topic-history-row"
    >
      <RecordDetail
        raw={
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            {entry.action} · {entry.by} · {entry.at}
            {entry.reason ? ` · ${entry.reason}` : ""}
          </p>
        }
      />
    </RecordRow>
  );
}
