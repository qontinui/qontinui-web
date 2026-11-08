"use client";

/**
 * The subproject chip beside a session — on `/sessions` rows and on the
 * session detail page (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6).
 *
 * `useSubprojectsBySessions` asks coord ONCE per page of sessions
 * (`GET /operations/subprojects/by-sessions`, at most 200 ids) and re-asks
 * only when the set of sessions on the page changes — never per row, and on
 * no timer of its own (membership moves far more slowly than the 10 s session
 * poll). The answer is kept per session across reads, so a chip does not
 * flicker to a dash while the next page's lookup is out.
 *
 * Only a member links. Every other state — no session id, not looked up yet,
 * past the 200 bound, a failed lookup, no live membership (a pending one
 * included), coord silent about this id — is a dash whose title says which
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

/** The lookup a surface uses; injectable for tests. */
export type SubprojectLookup = typeof fetchSubprojectsBySessions;

/**
 * The chip for each session id on a page. `sessionIds` may hold `null` (a
 * row with no Claude Code session id) and repeats; the first 200 distinct ids
 * are looked up in one read, so a caller lists the rows on screen first.
 */
export function useSubprojectsBySessions(
  sessionIds: ReadonlyArray<string | null>,
  lookup: SubprojectLookup = fetchSubprojectsBySessions
): (sessionId: string | null) => SubprojectChip {
  const asked = useMemo(() => {
    const out = new Set<string>();
    for (const id of sessionIds) {
      if (out.size === SUBPROJECT_LOOKUP_MAX_IDS) break;
      if (id) out.add(id);
    }
    return out;
  }, [sessionIds]);
  // The SET is the question, not its order: a re-sort or a re-filter that
  // keeps the same sessions does not ask again.
  const key = useMemo(() => [...asked].sort().join(","), [asked]);

  const [known, setKnown] = useState<
    ReadonlyMap<string, SubprojectOfSession | "none">
  >(new Map());
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    failure: SubprojectReadFailure;
  } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (key === "") return;
    const ids = key.split(",");
    seq.current += 1;
    const mine = seq.current;
    let alive = true;
    lookup(ids, COORD_DASHBOARD_POLL_OPTIONS)
      .then((body) => {
        if (!alive || mine !== seq.current) return;
        const items =
          typeof body?.items === "object" && body.items !== null
            ? body.items
            : {};
        const missing = new Set(
          Array.isArray(body?.missing) ? body.missing : []
        );
        setKnown((prev) => {
          const next = new Map(prev);
          for (const id of ids) {
            const item = Object.prototype.hasOwnProperty.call(items, id)
              ? items[id]
              : undefined;
            if (item && typeof item.id === "string") next.set(id, item);
            else if (missing.has(id)) next.set(id, "none");
            else next.delete(id);
          }
          return next;
        });
        setAnsweredKey(key);
        setFailure(null);
      })
      .catch((err: unknown) => {
        if (!alive || mine !== seq.current) return;
        setFailure({ key, failure: classifySubprojectReadFailure(err) });
      });
    return () => {
      alive = false;
    };
  }, [key, lookup]);

  return useCallback(
    (sessionId: string | null): SubprojectChip => {
      if (!sessionId) return { kind: "not_applicable" };
      const entry = known.get(sessionId);
      if (entry === "none") return { kind: "none" };
      if (entry !== undefined)
        return {
          kind: "member",
          id: entry.id,
          title: entry.title,
          headline: entry.headline,
        };
      if (!asked.has(sessionId)) return { kind: "not_looked_up" };
      if (failure !== null && failure.key === key)
        return { kind: "failed", failure: failure.failure };
      if (answeredKey === key) return { kind: "unanswered" };
      return { kind: "looking_up" };
    },
    [known, asked, failure, key, answeredKey]
  );
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
      {words.text}
      <span className="sr-only"> ({words.title})</span>
    </span>
  );
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
      {words.text}
      <span className="sr-only"> ({words.title})</span>
    </span>
  );
}
