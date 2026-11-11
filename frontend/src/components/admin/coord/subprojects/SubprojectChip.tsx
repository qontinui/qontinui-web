"use client";

/**
 * The subproject chip beside a session — on `/sessions` rows and on the
 * session detail page (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6).
 *
 * `useSubprojectsBySessions` asks coord in BATCHES
 * (`GET /operations/subprojects/by-sessions`, at most 200 ids a read — the
 * rows on screen first) and keeps each session's answer with WHEN it came. It
 * asks only for what is due:
 *
 * - a session it has never asked about — at once, when it appears;
 * - a session whose latest lookup failed, once that failure is
 *   {@link SUBPROJECT_CHIP_RETRY_MS} old;
 * - every other answer — a membership (the session may have been moved, or
 *   its subproject's headline changed), no subproject, coord not naming it —
 *   once it is {@link SUBPROJECT_CHIP_REASK_MS} old.
 *
 * An answer stays on screen while it is re-asked, so a chip never flickers to
 * a dash; and when the re-ask FAILS, the last answer stays too, said to be
 * not current (R6's stale arm) — a dash replaces it only when no answer was
 * ever had.
 *
 * WHEN it checks is the caller's: on every new `sessionIds` array — the
 * sessions console hands it one per list poll, so the console's ONE visible
 * poll (`SessionsConsolePolling.test.tsx`) is also this lookup's slow poll,
 * and its due rules keep that to the reads above — and on `recheck`, which a
 * page without a list poll of its own (the session detail page) runs on a slow
 * visible poll ({@link SUBPROJECT_CHIP_POLL_MS}). The answers persist across
 * reads, so a chip never flickers to a dash while the next batch is out.
 *
 * Only a member links. Every other state — no session id, an agent half that
 * did not answer, looking up, a failed lookup, no live membership (a pending
 * one included), coord silent about this id — is a dash whose title says
 * which and whose accessible name is a short phrase
 * (`subprojectStatus.ts` `subprojectChipWords`): never a guess.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  SUBPROJECT_LOOKUP_MAX_IDS,
  fetchSubprojectsBySessions,
  type SubprojectOfSession,
} from "@/lib/api/operations/coordSubprojects";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import {
  classifySubprojectReadFailure,
  subprojectChipWords,
  type SubprojectChip,
  type SubprojectReadFailure,
} from "./subprojectStatus";

/** How often a page with no list poll of its own re-checks what is due. */
export const SUBPROJECT_CHIP_POLL_MS = 60_000;
/** How old a failed lookup gets before it is retried. */
export const SUBPROJECT_CHIP_RETRY_MS = 60_000;
/** How old ANY answer gets before it is re-asked — a membership included (a
 *  session can be moved, a headline changes), as well as "no subproject" and
 *  an id coord did not name. */
export const SUBPROJECT_CHIP_REASK_MS = 180_000;

/** The lookup a surface uses; injectable for tests. */
export type SubprojectLookup = typeof fetchSubprojectsBySessions;

/** What coord last answered for one session, and when (epoch ms). */
type Answer =
  | ({ kind: "member"; at: number } & SubprojectOfSession)
  | { kind: "none" | "unanswered"; at: number };

/** One session's state: its last answer, if any, and the latest lookup's
 *  failure, when that lookup failed. */
interface Entry {
  answer: Answer | null;
  failure: { failure: SubprojectReadFailure; at: number } | null;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/** Is this session due to be asked (again) at `now`? */
function isDue(entry: Entry | undefined, now: number): boolean {
  if (entry === undefined) return true;
  if (entry.failure !== null)
    return now - entry.failure.at >= SUBPROJECT_CHIP_RETRY_MS;
  return (
    entry.answer === null || now - entry.answer.at >= SUBPROJECT_CHIP_REASK_MS
  );
}

export interface SubprojectsBySessions {
  /** The chip for one session id (`null`: the row has none). */
  chipOf: (sessionId: string | null) => SubprojectChip;
  /** Ask about every session that is due now. */
  recheck: () => Promise<void>;
}

/**
 * The chips for a page of sessions. `sessionIds` may hold `null` (a row with
 * no Claude Code session id) and repeats; list the rows on screen first,
 * since they are asked about first. Every new array is a check for what is
 * due.
 */
export function useSubprojectsBySessions(
  sessionIds: ReadonlyArray<string | null>,
  lookup: SubprojectLookup = fetchSubprojectsBySessions
): SubprojectsBySessions {
  const ids = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of sessionIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [sessionIds]);
  const idsRef = useRef(ids);
  useEffect(() => {
    idsRef.current = ids;
  }, [ids]);

  // The answers are state, for the page, and mirrored in a ref, for the
  // lookup, which must read its own writes in the same tick.
  const [known, setKnown] = useState<ReadonlyMap<string, Entry>>(
    () => new Map()
  );
  const entries = useRef<ReadonlyMap<string, Entry>>(known);
  const asking = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const record = useCallback(
    (update: ReadonlyArray<[string, (prev: Entry | undefined) => Entry]>) => {
      const next = new Map(entries.current);
      for (const [id, entryFor] of update) next.set(id, entryFor(next.get(id)));
      entries.current = next;
      setKnown(next);
    },
    []
  );

  const recheck = useCallback(async () => {
    const now = Date.now();
    const due = idsRef.current.filter(
      (id) => !asking.current.has(id) && isDue(entries.current.get(id), now)
    );
    if (due.length === 0) return;
    for (const id of due) asking.current.add(id);
    await Promise.all(
      chunked(due, SUBPROJECT_LOOKUP_MAX_IDS).map(async (batch) => {
        try {
          const body = await lookup(batch, COORD_DASHBOARD_POLL_OPTIONS);
          if (!alive.current) return;
          const at = Date.now();
          const items =
            typeof body?.items === "object" && body.items !== null
              ? body.items
              : {};
          const missing = new Set(
            Array.isArray(body?.missing) ? body.missing : []
          );
          record(
            batch.map((id) => {
              const item = Object.prototype.hasOwnProperty.call(items, id)
                ? items[id]
                : undefined;
              const answer: Answer =
                item && typeof item.id === "string"
                  ? {
                      kind: "member",
                      at,
                      id: item.id,
                      title: item.title,
                      headline: item.headline,
                    }
                  : { kind: missing.has(id) ? "none" : "unanswered", at };
              return [id, () => ({ answer, failure: null })];
            })
          );
        } catch (err) {
          if (!alive.current) return;
          const failure = {
            failure: classifySubprojectReadFailure(err),
            at: Date.now(),
          };
          // The last answer, if any, stays — said to be not current.
          record(
            batch.map((id) => [
              id,
              (prev) => ({ answer: prev?.answer ?? null, failure }),
            ])
          );
        } finally {
          for (const id of batch) asking.current.delete(id);
        }
      })
    );
  }, [lookup, record]);

  // Every new list of sessions is a check: a new session is asked about at
  // once, and an answer that has come due is asked again.
  useEffect(() => {
    void recheck();
  }, [sessionIds, recheck]);

  const chipOf = useCallback(
    (sessionId: string | null): SubprojectChip => {
      if (!sessionId) return { kind: "not_applicable" };
      const entry = known.get(sessionId);
      if (entry === undefined) return { kind: "looking_up" };
      const { answer, failure } = entry;
      if (answer === null)
        return failure
          ? { kind: "failed", failure: failure.failure }
          : { kind: "looking_up" };
      const stale = failure?.failure ?? null;
      return answer.kind === "member"
        ? {
            kind: "member",
            id: answer.id,
            title: answer.title,
            headline: answer.headline,
            stale,
          }
        : { kind: answer.kind, stale };
    },
    [known]
  );

  return { chipOf, recheck };
}

/** One chip: the subproject's title as a link, or a dash that says why. */
export function SubprojectChipCell({
  chip,
  className,
  "data-testid": testId,
}: {
  chip: SubprojectChip;
  className?: string;
  "data-testid"?: string;
}) {
  const words = subprojectChipWords(chip);
  if (words.href) {
    return (
      <Link
        href={words.href}
        title={words.title}
        aria-label={words.label}
        className={[
          "underline underline-offset-2 hover:text-foreground",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={testId}
        data-chip={chip.kind}
      >
        {words.text}
        <StaleMark stale={words.stale} />
      </Link>
    );
  }
  return (
    <span
      title={words.title}
      className={className}
      data-testid={testId}
      data-chip={chip.kind}
    >
      <span aria-hidden="true">
        {words.text}
        <StaleMark stale={words.stale} />
      </span>
      <span className="sr-only">{words.label}</span>
    </span>
  );
}

/** The visible mark of a kept answer whose re-ask failed — the same `*` a
 *  stale count carries on a tab. Screen readers hear "not current" in the
 *  chip's accessible name instead. */
function StaleMark({ stale }: { stale: boolean }) {
  return stale ? (
    <span aria-hidden="true" className="text-muted-foreground">
      *
    </span>
  ) : null;
}

/**
 * The chip as TEXT, for a place that is itself a control: a record row's
 * line is one button, so a link inside it would be nested interactive content
 * and would toggle the row as well. The row's expanded detail carries the
 * link (`SubprojectChipCell`).
 */
export function SubprojectChipText({ chip }: { chip: SubprojectChip }) {
  const words = subprojectChipWords(chip);
  return (
    <span title={words.title} data-chip={chip.kind}>
      <span aria-hidden="true">
        {words.text}
        <StaleMark stale={words.stale} />
      </span>
      <span className="sr-only">{words.label}</span>
    </span>
  );
}
