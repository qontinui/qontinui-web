"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildCalibrationBatch,
  fetchTasteInbox,
  labelTastePair,
  skipTastePair,
  undoTasteLabel,
  uploadReferenceImage,
  writeTasteBudget,
  type CalibrationBatchResult,
  type ImageAssetKind,
  type TasteInbox,
  type TasteLabelWrite,
} from "@/lib/api/taste";
import { BackendError } from "@/lib/errors/backend-error-message";
import { summarizeReferenceUploads } from "../_lib/tasteInbox";

/** How many queued pairs one read asks for: the card shows the first, and
 *  the rest tell the operator what is next without another round trip. */
export const QUEUE_HEAD = 5;

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function statusOf(err: unknown): number | null {
  return err instanceof BackendError ? err.status : null;
}

/**
 * The taste inbox's state: the one read, and every write followed by a
 * re-read.
 *
 * What the page shows always comes from a READ, never from what a write asked
 * for — so after "label, skip, both bad, refresh" the queue on screen is the
 * queue the server holds, and nothing is dropped or shown twice by a local
 * guess. A read that started before a write is discarded when it resolves
 * (the write's own re-read supersedes it), so a slow refresh cannot repaint a
 * pair the operator just answered. A failed read keeps the last good inbox on
 * screen and says the read failed, rather than blanking the queue into
 * something that looks empty.
 *
 * One write at a time: a second write asked for while one is in flight is
 * dropped (a ref, not the `busy` state, guards it — two key presses inside
 * one render would both read `busy` as false), so a double press never
 * sends a pair twice.
 */
export function useTasteInbox() {
  const [inbox, setInbox] = useState<TasteInbox | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [overBudget, setOverBudget] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  /** The tag of the write whose re-read produced the current state (or
   *  null: an initial read, a refresh). Set with that read's result in the
   *  same render — on a failed read too — so the page can tell the swap a
   *  write CAUSED from an unrelated one. */
  const [readTag, setReadTag] = useState<number | null>(null);
  const keepGoingTag = useRef<number | null>(null);

  const load = useCallback(
    async (keepGoing: boolean, tag: number | null = null) => {
      const mine = ++generation.current;
      try {
        const next = await fetchTasteInbox({
          limit: QUEUE_HEAD,
          overBudget: keepGoing,
        });
        if (mine !== generation.current) return;
        setInbox(next);
        setReadError(null);
        setReadTag(tag);
      } catch (err) {
        if (mine !== generation.current) return;
        setReadError(message(err, "The taste inbox could not be read."));
        setReadTag(tag);
      }
    },
    []
  );

  useEffect(() => {
    const tag = keepGoingTag.current;
    keepGoingTag.current = null;
    void load(overBudget, tag);
  }, [load, overBudget]);

  /** "Keep labelling anyway": ask for the queue head past the budget. */
  const keepGoing = useCallback((tag: number | null = null) => {
    keepGoingTag.current = tag;
    setOverBudget(true);
  }, []);

  const refresh = useCallback(() => load(overBudget), [load, overBudget]);

  /** Run one write, then re-read. Returns the write's answer, or null when
   *  it did not land or another write was already in flight. A 409 shows
   *  `conflict`, or — with `conflictFromServer` — the server's own
   *  sentence. */
  const write = useCallback(
    async <T>(
      run: () => Promise<T>,
      describe: {
        failed: string;
        conflict?: string;
        conflictFromServer?: boolean;
      },
      tag: number | null = null
    ): Promise<T | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      try {
        const result = await run();
        return result;
      } catch (err) {
        if (statusOf(err) === 409 && describe.conflictFromServer) {
          toast.info(message(err, describe.failed));
        } else if (statusOf(err) === 409 && describe.conflict) {
          toast.info(describe.conflict);
        } else {
          toast.error(message(err, describe.failed));
        }
        return null;
      } finally {
        // Re-read whether or not the write landed: a 409 means the server
        // moved on without us, and the screen should show where it is now.
        await load(overBudget, tag);
        inFlight.current = false;
        setBusy(false);
      }
    },
    [load, overBudget]
  );

  const label = useCallback(
    (pairId: string, body: TasteLabelWrite, tag: number | null = null) =>
      write(
        () => labelTastePair(pairId, body),
        {
          failed: "The label was not saved.",
          conflict:
            "Someone else answered that pair first — the inbox now shows theirs.",
        },
        tag
      ),
    [write]
  );

  const skip = useCallback(
    (pairId: string, tag: number | null = null) =>
      write(
        () => skipTastePair(pairId),
        {
          failed: "The pair was not skipped.",
          conflict: "That pair was answered meanwhile.",
        },
        tag
      ),
    [write]
  );

  /** Undo the viewer's own label, or — `force` — a colleague's, which the
   *  server records as forced. A 409 (already undone, or not yours) shows
   *  the server's sentence. */
  const undo = useCallback(
    (pairId: string, force = false, tag: number | null = null) =>
      write(
        () => undoTasteLabel(pairId, { force }),
        {
          failed: "The label was not undone.",
          conflictFromServer: true,
        },
        tag
      ),
    [write]
  );

  const buildBatch = useCallback(
    async (size: number): Promise<CalibrationBatchResult | null> => {
      const result = await write(() => buildCalibrationBatch(size), {
        failed: "The calibration batch was not built.",
      });
      if (result) {
        if (result.shortfall === "pool_too_small") {
          toast.info(
            "A calibration batch needs at least two of this project's images — upload references or generate candidates first."
          );
        } else {
          toast.success(
            `Queued ${result.created} calibration ${result.created === 1 ? "pair" : "pairs"}` +
              (result.already_queued
                ? ` (${result.already_queued} already queued).`
                : ".")
          );
        }
      }
      return result;
    },
    [write]
  );

  const setBudget = useCallback(
    async (weekly: number) => {
      const result = await write(() => writeTasteBudget(weekly), {
        failed: "The weekly budget was not saved.",
      });
      if (result)
        toast.success(`Weekly budget set to ${result.weekly_budget}.`);
      return result;
    },
    [write]
  );

  const uploadReferences = useCallback(
    async (files: File[]) => {
      const stored: { kind: ImageAssetKind }[] = [];
      for (const file of files) {
        const result = await write(() => uploadReferenceImage(file), {
          failed: `${file.name} was not uploaded.`,
        });
        if (result) stored.push(result);
      }
      const summary = summarizeReferenceUploads(stored);
      if (summary) toast[summary.tone](summary.message);
      return stored.length;
    },
    [write]
  );

  return {
    inbox,
    readError,
    busy,
    overBudget,
    keepGoing,
    readTag,
    refresh,
    label,
    skip,
    undo,
    buildBatch,
    setBudget,
    uploadReferences,
  };
}
