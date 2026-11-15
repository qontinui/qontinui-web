"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isWriteFailureUnknown,
  outcomeUnknownReason,
} from "@/components/admin/coord/writeOutcome";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import {
  fetchSpawnLaunchSettings,
  putSpawnLaunchSetting,
  type SpawnLaunchSettingRow,
  type SpawnLaunchSettingWrite,
  type SpawnLaunchSettingsResponse,
} from "@/lib/api/spawnLaunchSettings";

/** One row's last write, as far as this page knows. */
export type LaunchWriteState =
  | { phase: "saving" }
  | { phase: "saved"; at: number }
  /** Coord refused it: nothing was written; the row keeps coord's value. */
  | { phase: "refused"; message: string }
  /** The answer left it open: the row is UNKNOWN until a later read answers. */
  | { phase: "unknown"; reason: string };

/**
 * The spawn launch settings (model + effort per spawn type) and per-row writes.
 *
 * Plan `2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type`
 * Phase 5. Honesty properties:
 *
 * 1. **A failed read is never "inherit".** With no answer `data` stays `null`
 *    and `error` says why; after an answer, a failed refresh keeps the last
 *    good rows and sets `error`, which the panel labels STALE.
 * 2. **After a write a row shows coord's answer** — the PUT's response is the
 *    row as coord now holds it — never the value that was asked for.
 * 3. **Ordering.** Every read and every write read-back takes a ticket from
 *    one counter; a read whose ticket is older than a row's write read-back
 *    does not paint over that row, so a refresh issued before a save resolved
 *    cannot restore the pre-write value.
 * 4. **An open write outcome is UNKNOWN, never a failure**
 *    (`isWriteFailureUnknown`): the row says so and a re-read starts at once;
 *    only a read issued after it retires the mark.
 */
export function useSpawnLaunchSettings() {
  const [data, setData] = useState<SpawnLaunchSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [writes, setWrites] = useState<
    Readonly<Record<string, LaunchWriteState>>
  >({});
  const [asOfMs, setAsOfMs] = useState<number | null>(null);
  const tickets = useRef(0);
  /** Newest delivered read's ticket. */
  const deliveredRead = useRef(0);
  /** Per spawn type: the ticket at which its row was last set by a write. */
  const rowTicket = useRef(new Map<string, number>());
  /** Per spawn type: the ticket at which a write left it UNKNOWN. */
  const unknownAt = useRef(new Map<string, number>());

  const reload = useCallback(async (): Promise<void> => {
    const ticket = (tickets.current += 1);
    setLoading(true);
    try {
      const answer = await fetchSpawnLaunchSettings();
      if (ticket < deliveredRead.current) return; // a newer read already shown
      deliveredRead.current = ticket;
      setData((prev) => {
        if (!prev) return answer;
        // A row written after this read was issued keeps its read-back.
        const kept = new Map(prev.settings.map((r) => [r.spawn_type, r]));
        return {
          ...answer,
          settings: answer.settings.map((row) => {
            const writtenAt = rowTicket.current.get(row.spawn_type) ?? 0;
            return writtenAt > ticket ? (kept.get(row.spawn_type) ?? row) : row;
          }),
        };
      });
      setError(null);
      setAsOfMs(Date.now());
      // A read issued after an open write answers it.
      setWrites((prev) => {
        let next: Record<string, LaunchWriteState> | null = null;
        for (const [type, state] of Object.entries(prev)) {
          if (
            state.phase === "unknown" &&
            ticket > (unknownAt.current.get(type) ?? 0)
          ) {
            next ??= { ...prev };
            delete next[type];
          }
        }
        return next ?? prev;
      });
    } catch (err) {
      if (ticket >= deliveredRead.current) {
        setError(operationsErrorMessage(err));
      }
    } finally {
      if (ticket === tickets.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (
      spawnType: string,
      write: SpawnLaunchSettingWrite
    ): Promise<boolean> => {
      setWrites((prev) => ({ ...prev, [spawnType]: { phase: "saving" } }));
      try {
        const row: SpawnLaunchSettingRow = await putSpawnLaunchSetting(
          spawnType,
          write
        );
        // Ticketed when the PUT resolves: coord answered after committing, so
        // any read issued before now may carry the pre-write value.
        const ticket = (tickets.current += 1);
        rowTicket.current.set(spawnType, ticket);
        setData((prev) =>
          prev
            ? {
                ...prev,
                settings: prev.settings.map((r) =>
                  r.spawn_type === spawnType ? row : r
                ),
              }
            : prev
        );
        setWrites((prev) => ({
          ...prev,
          [spawnType]: { phase: "saved", at: Date.now() },
        }));
        return true;
      } catch (err) {
        if (isWriteFailureUnknown(err)) {
          const ticket = (tickets.current += 1);
          unknownAt.current.set(spawnType, ticket);
          setWrites((prev) => ({
            ...prev,
            [spawnType]: {
              phase: "unknown",
              reason: outcomeUnknownReason(err),
            },
          }));
          await reload();
          return false;
        }
        setWrites((prev) => ({
          ...prev,
          [spawnType]: {
            phase: "refused",
            message: operationsErrorMessage(err),
          },
        }));
        return false;
      }
    },
    [reload]
  );

  return { data, error, loading, asOfMs, writes, reload, save };
}
