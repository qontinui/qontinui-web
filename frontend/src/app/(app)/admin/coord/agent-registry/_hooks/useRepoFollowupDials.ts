"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createReadSequence, type ReadSequence } from "@/components/console";
import { listRegisteredRepos } from "@/lib/api/operations/sessions";
import {
  fetchContinuationDeliveryMode,
  fetchPostMergeFollowupScope,
  putContinuationDeliveryMode,
  putPostMergeFollowupScope,
} from "@/lib/api/operations/coordSettings";
import {
  EMPTY_READING,
  type DeliveryMode,
  type FollowupScope,
  type RepoDialReading,
} from "../_lib/repoFollowupStatus";

/** Per-repo reads are fanned out this many repos at a time, not all at once. */
export const READ_CONCURRENCY = 4;

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Run `run` over `items`, at most `limit` at a time. */
export async function inPool<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (let i = next; i < items.length; i = next) {
        next = i + 1;
        await run(items[i] as T);
      }
    }
  );
  await Promise.all(workers);
}

type Dial = "scope" | "delivery";

/**
 * Per (repo, dial) bookkeeping: the read sequence that orders every read AND
 * write read-back for that dial, the newest ticket whose read-back FAILED
 * (only a later delivery may retire that UNKNOWN), and the last read error.
 */
interface DialBook {
  seq: ReadSequence;
  readbackFailedAt: number;
}

/**
 * The tenant's repos, each with its post-merge follow-up scope and its
 * continuation-delivery mode.
 *
 * Plan `2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind`
 * Phase 4b. The repo list is the tenant's registered canonical repos
 * (`GET /api/v1/operations/repos`, via the shared `listRegisteredRepos`
 * cache); each repo's two dials are separate reads, so one repo's failure
 * leaves the others shown.
 *
 * Honesty properties:
 *
 * 1. **A failed read never becomes a value.** No `scope` is ever synthesised:
 *    a repo whose read failed has `scope: null` + `scopeError` (UNKNOWN), or
 *    keeps its previous value with `scopeError` set (STALE, labelled).
 * 2. **What is displayed after a write is the write's READ-BACK**, never the
 *    written value. A failed read-back sets `*ReadbackError` (UNKNOWN) until a
 *    read issued AFTER that write delivers.
 * 3. **Ordering is the console's `readSequence`, one per (repo, dial)** —
 *    reads and write read-backs take tickets from the same sequence, so a
 *    refresh issued before a write's PUT resolved (ticketed at resolution,
 *    since coord read back after committing) cannot paint the pre-write
 *    value over the read-back or retire a failed read-back's UNKNOWN, and a superseded-but-
 *    successful read is still an answer (never discarded for being old) when
 *    nothing newer has delivered.
 */
export function useRepoFollowupDials() {
  const [repos, setRepos] = useState<string[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [readings, setReadings] = useState<
    Readonly<Record<string, RepoDialReading>>
  >({});
  const [loading, setLoading] = useState(true);
  /** `${repo}:scope` / `${repo}:delivery` — the write in flight. */
  const [saving, setSaving] = useState<string | null>(null);
  const [writeErrors, setWriteErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const books = useRef(new Map<string, DialBook>());
  const listSeq = useRef(createReadSequence());
  const reloads = useRef(0);

  const book = useCallback((repo: string, dial: Dial): DialBook => {
    const key = `${repo}:${dial}`;
    let b = books.current.get(key);
    if (!b) {
      b = { seq: createReadSequence(), readbackFailedAt: 0 };
      books.current.set(key, b);
    }
    return b;
  }, []);

  const patch = useCallback(
    (repo: string, update: Partial<RepoDialReading>) =>
      setReadings((prev) => ({
        ...prev,
        [repo]: { ...(prev[repo] ?? EMPTY_READING), ...update },
      })),
    []
  );

  /**
   * Settle one read of a dial and patch what it entitles. `value` undefined
   * means the read failed with `error`.
   */
  const settleRead = useCallback(
    <V>(
      repo: string,
      dial: Dial,
      ticket: number,
      outcome: { value: V } | { error: string }
    ) => {
      const b = book(repo, dial);
      const valueKey = dial;
      const errorKey = dial === "scope" ? "scopeError" : "deliveryError";
      const readbackKey =
        dial === "scope" ? "scopeReadbackError" : "deliveryReadbackError";
      if ("value" in outcome) {
        if (!b.seq.settle(ticket, true)) return; // a newer delivery already shown
        const update: Partial<RepoDialReading> = {
          [valueKey]: outcome.value,
        } as Partial<RepoDialReading>;
        // Still stale if a NEWER read finished without delivering.
        if (!b.seq.isStale()) {
          (update as Record<string, unknown>)[errorKey] = null;
        }
        if (ticket > b.readbackFailedAt) {
          (update as Record<string, unknown>)[readbackKey] = null;
        }
        patch(repo, update);
      } else {
        b.seq.settle(ticket, false);
        // Report the failure only when it is the newest thing known: an older
        // failure landing after a newer success says nothing about the value.
        if (b.seq.isStale() || !b.seq.hasDelivered()) {
          patch(repo, {
            [errorKey]: outcome.error,
          } as Partial<RepoDialReading>);
        }
      }
    },
    [book, patch]
  );

  const readScope = useCallback(
    async (repo: string) => {
      const ticket = book(repo, "scope").seq.issue();
      try {
        const view = await fetchPostMergeFollowupScope(repo);
        settleRead(repo, "scope", ticket, { value: view });
      } catch (err) {
        settleRead(repo, "scope", ticket, {
          error: message(err, "the scope read failed"),
        });
      }
    },
    [book, settleRead]
  );

  const readDelivery = useCallback(
    async (repo: string) => {
      const ticket = book(repo, "delivery").seq.issue();
      try {
        const view = await fetchContinuationDeliveryMode(repo);
        settleRead(repo, "delivery", ticket, { value: view });
      } catch (err) {
        settleRead(repo, "delivery", ticket, {
          error: message(err, "the delivery-mode read failed"),
        });
      }
    },
    [book, settleRead]
  );

  const reload = useCallback(async (): Promise<void> => {
    const run = (reloads.current += 1);
    setLoading(true);
    try {
      const ticket = listSeq.current.issue();
      let list: string[];
      try {
        list = (await listRegisteredRepos()).map((r) => r.repo).sort();
      } catch (err) {
        listSeq.current.settle(ticket, false);
        // The list is UNKNOWN — keep whatever was shown, labelled by the
        // error, rather than rendering "this tenant has no repos".
        if (listSeq.current.isStale() || !listSeq.current.hasDelivered()) {
          setReposError(message(err, "the repo list could not be read"));
        }
        return;
      }
      if (!listSeq.current.settle(ticket, true)) return;
      setRepos(list);
      if (!listSeq.current.isStale()) setReposError(null);
      await inPool(list, READ_CONCURRENCY, async (repo) => {
        await Promise.all([readScope(repo), readDelivery(repo)]);
      });
    } finally {
      if (run === reloads.current) setLoading(false);
    }
  }, [readScope, readDelivery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clearWriteError = (key: string) =>
    setWriteErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  /**
   * Apply a write's outcome. The read-back is a read of the dial, ordered on
   * the same sequence as every refresh: its ticket is taken when the PUT
   * RESOLVES, so any refresh issued before then (which may carry the
   * pre-write value) orders before it — it can neither replace the read-back
   * nor retire a failed read-back's UNKNOWN.
   */
  const settleWrite = useCallback(
    <V>(
      repo: string,
      dial: Dial,
      ticket: number,
      effective: V | null,
      readbackError: string | null
    ) => {
      const b = book(repo, dial);
      if (effective !== null) {
        settleRead(repo, dial, ticket, { value: effective });
        return;
      }
      // Written, but unconfirmed: UNKNOWN until a read issued after this
      // ticket delivers. Never paint the written value.
      b.seq.settle(ticket, false);
      b.readbackFailedAt = Math.max(b.readbackFailedAt, ticket);
      const key =
        dial === "scope" ? "scopeReadbackError" : "deliveryReadbackError";
      patch(repo, {
        [key]: readbackError ?? "read-back returned nothing",
      } as Partial<RepoDialReading>);
    },
    [book, patch, settleRead]
  );

  const writeScope = useCallback(
    async (body: {
      repo: string;
      scope: FollowupScope;
      code_paths?: string[];
    }): Promise<boolean> => {
      const key = `${body.repo}:scope`;
      setSaving(key);
      clearWriteError(key);
      try {
        const result = await putPostMergeFollowupScope(body);
        // Ticket taken when the PUT RESOLVES, not when it starts: coord ran
        // the read-back after committing, so every refresh issued before this
        // point may carry the pre-write value and must order BEFORE it.
        const ticket = book(body.repo, "scope").seq.issue();
        settleWrite(
          body.repo,
          "scope",
          ticket,
          result.effective,
          result.readback_error
        );
        if (result.effective) {
          toast.success(`${body.repo}: follow-up scope saved.`);
        } else {
          toast.warning(
            `${body.repo}: the write went through, but the read-back failed — ` +
              "what coord resolves is unknown until this refreshes."
          );
        }
        return true;
      } catch (err) {
        // A refused write delivered nothing and is not a read: it takes no
        // ticket, so it neither updates nor stales the displayed value.
        const text = message(err, "the write failed");
        setWriteErrors((prev) => ({ ...prev, [key]: text }));
        toast.error(`${body.repo}: ${text}`);
        return false;
      } finally {
        setSaving(null);
      }
    },
    [book, settleWrite]
  );

  const writeDelivery = useCallback(
    async (repo: string, mode: DeliveryMode): Promise<boolean> => {
      const key = `${repo}:delivery`;
      setSaving(key);
      clearWriteError(key);
      try {
        const result = await putContinuationDeliveryMode(repo, mode);
        const ticket = book(repo, "delivery").seq.issue();
        settleWrite(
          repo,
          "delivery",
          ticket,
          result.effective,
          result.readback_error
        );
        if (result.effective) {
          toast.success(`${repo}: delivery mode saved.`);
        } else {
          toast.warning(
            `${repo}: the write went through, but the read-back failed — ` +
              "what coord resolves is unknown until this refreshes."
          );
        }
        return true;
      } catch (err) {
        const text = message(err, "the write failed");
        setWriteErrors((prev) => ({ ...prev, [key]: text }));
        toast.error(`${repo}: ${text}`);
        return false;
      } finally {
        setSaving(null);
      }
    },
    [book, settleWrite]
  );

  return {
    repos,
    reposError,
    readings,
    loading,
    saving,
    /** Keyed `${repo}:scope` / `${repo}:delivery`; cleared by the next write. */
    writeErrors,
    reload,
    writeScope,
    writeDelivery,
  };
}
