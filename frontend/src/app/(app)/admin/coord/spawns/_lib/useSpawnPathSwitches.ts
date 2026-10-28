"use client";

/**
 * The reads and writes behind the spawn-path matrix.
 *
 * Every read is an EXISTING door, through its existing client — never coord
 * from the browser:
 *
 * | read | door | client |
 * |---|---|---|
 * | the tenant defaults (what coord enforces) | `GET /api/v1/agent-registry/admin/registry` → `/coord/agent-registry` | `listAdminAgentRegistry` |
 * | the signed-in member's fold (their own preference rows) | `GET /api/v1/agent-registry` → `/coord/agent-registry/effective-for` | `listAgentRegistry` |
 * | the autonomy levels and fleet flags | `GET /api/v1/operations/coord/next-step-settings` | `fetchNextStepSettings` |
 * | the PR fixer dial and the merge-settings knobs | `GET /api/v1/operations/pr-merge/settings` | `useAutoFixPrSetting` (the settings page's hook) |
 * | the per-repo follow-up scopes and their rollout mode | `GET /api/v1/operations/post-merge-followup-scope` | `useRepoFollowupDials` (the agent registry page's hook) |
 *
 * The first three are this hook's own: they poll together, single-flight,
 * with no client retries (`COORD_DASHBOARD_POLL_OPTIONS` — the next tick is
 * the retry), each ordered by its own `ReadSequence`: a read that finishes
 * after a newer one delivered never paints over it, and a failed read keeps
 * the last good answer, labelled stale. The other two are the hooks of the
 * pages that own those settings, with those pages' own load and retry rules;
 * the page's refresh re-reads them.
 *
 * ## Writes, and what is shown after one
 *
 * Each write goes through its existing door and records what was ASKED
 * (`SwitchWrite`); what the matrix then shows is the READ-BACK, never the
 * request (`spawnPathGates.ts` `withWrite`):
 *
 * - `PUT /coord/agent-registry/:agent_name` (`putAgentRegistryDefaults`):
 *   re-reads the tenant defaults (and the member's fold), ticketed when the
 *   PUT resolves, so a poll issued before it cannot paint the pre-write value
 *   over it. A failed re-read of the defaults is UNKNOWN.
 * - `PUT /coord/next-step-settings` (`putNextStepSettings`): coord answers its
 *   authoritative state after the write, applied as a read.
 * - `PATCH /pr-merge/settings {auto_fix_pr}` (the dial hook's `setChoice`):
 *   `saved` is coord's answer reading back what was sent; `refused` keeps
 *   coord's value and says so; `unconfirmed` is UNKNOWN until the hook's
 *   re-read settles, then that read is the read-back.
 * - `PATCH /pr-merge/settings {auto_fix_red_main}`
 *   (`patchTenantAutoFixRedMain`): the read-back is the dial hook's re-read,
 *   made after the write resolved.
 *
 * One write per switch at a time: a second write to a switch whose first has
 * not read back is refused with an error, never raced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReadSequence, type ReadSequence } from "@/components/console";
import { COORD_DASHBOARD_POLL_OPTIONS } from "@/components/operations/coordPollError";
import { useSingleFlightPoll } from "@/components/operations/useSingleFlightPoll";
import {
  AgentPrefError,
  listAdminAgentRegistry,
  listAgentRegistry,
  putAgentRegistryDefaults,
  type AdminAgentRegistryRow,
  type AgentRegistryEntry,
} from "@/lib/api/agent-registry";
import {
  fetchNextStepSettings,
  putNextStepSettings,
  type AutonomyLevel,
  type NextStepSettings,
} from "@/lib/api/operations/coordSettings";
import { patchTenantAutoFixRedMain } from "@/lib/api/operations/prMerge";
import {
  useAutoFixPrSetting,
  type AutoFixPrReread,
} from "@/app/(app)/settings/coordination/_hooks/useAutoFixPrSetting";
import {
  isUnconfirmedWrite,
  type AutoFixPrChoice,
} from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import { useRepoFollowupDials } from "@/app/(app)/admin/coord/agent-registry/_hooks/useRepoFollowupDials";
import type {
  FollowupRead,
  MergeSettingsRead,
  ReadPart,
  SwitchWrite,
} from "./spawnPathGates";

/** Switches change by an operator's action; a minute catches another operator's. */
export const SWITCHES_POLL_MS = 60_000;

/** What a failed registry or settings read says, in the operator's words. */
export function switchReadErrorText(err: unknown): string {
  if (err instanceof AgentPrefError && err.status === 403) {
    return "only a coord tenant admin of the active project may read it (HTTP 403)";
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

const EMPTY_PART = {
  data: null,
  error: null,
  asOfMs: null,
  loading: true,
} as const;

interface Parts {
  effective: ReadPart<AgentRegistryEntry[]>;
  defaults: ReadPart<AdminAgentRegistryRow[]>;
  nextStep: ReadPart<NextStepSettings>;
}

type PartKey = keyof Parts;

/** Fold one settled read into its part, ordered by the part's sequence. */
function settlePart<T>(
  prev: ReadPart<T>,
  seq: ReadSequence,
  ticket: number,
  result: PromiseSettledResult<T>
): ReadPart<T> {
  if (result.status === "fulfilled") {
    if (!seq.settle(ticket, true)) return { ...prev, loading: false };
    return {
      data: result.value,
      // Still stale when a NEWER read finished without delivering.
      error: seq.isStale() ? prev.error : null,
      asOfMs: Date.now(),
      loading: false,
    };
  }
  seq.settle(ticket, false);
  // Only the newest thing known may report a failure: an older failure landing
  // after a newer success says nothing about the value on screen.
  if (seq.isStale() || !seq.hasDelivered()) {
    return {
      ...prev,
      error: switchReadErrorText(result.reason),
      loading: false,
    };
  }
  return { ...prev, loading: false };
}

/** The refusal a second write to a switch gets while its first is reading back. */
export const WRITE_IN_FLIGHT =
  "A write to this switch is still in flight; wait for its read-back.";

export interface SpawnPathSwitches {
  effective: ReadPart<AgentRegistryEntry[]>;
  defaults: ReadPart<AdminAgentRegistryRow[]>;
  nextStep: ReadPart<NextStepSettings>;
  mergeSettings: MergeSettingsRead;
  followup: FollowupRead;
  /** When the follow-up scopes were last answered (they carry no as-of). */
  followupAsOfMs: number | null;
  /** When the merge settings were last answered (they carry no as-of). */
  mergeSettingsAsOfMs: number | null;
  writes: Readonly<Record<string, SwitchWrite>>;
  /** Re-read every source now. */
  refresh: () => Promise<void>;
  setRegistryDefault: (agentName: string, enabled: boolean) => Promise<void>;
  setAutonomyLevel: (domain: string, level: AutonomyLevel) => Promise<void>;
  setFixerDial: (choice: AutoFixPrChoice) => Promise<void>;
  setRedMainKnob: (enabled: boolean) => Promise<void>;
}

export function useSpawnPathSwitches(): SpawnPathSwitches {
  const [parts, setParts] = useState<Parts>({
    effective: EMPTY_PART,
    defaults: EMPTY_PART,
    nextStep: EMPTY_PART,
  });
  const [writes, setWrites] = useState<Readonly<Record<string, SwitchWrite>>>(
    {}
  );
  const seqs = useRef<Record<PartKey, ReadSequence>>({
    effective: createReadSequence(),
    defaults: createReadSequence(),
    nextStep: createReadSequence(),
  });
  /** Gate keys whose write has not yet read back. */
  const inFlight = useRef(new Set<string>());
  const dial = useAutoFixPrSetting();
  const followup = useRepoFollowupDials();
  const [followupAsOfMs, setFollowupAsOfMs] = useState<number | null>(null);

  const apply = useCallback(
    <K extends PartKey>(
      key: K,
      ticket: number,
      result: PromiseSettledResult<NonNullable<Parts[K]["data"]>>
    ) => {
      setParts((prev) => ({
        ...prev,
        [key]: settlePart(
          prev[key] as ReadPart<NonNullable<Parts[K]["data"]>>,
          seqs.current[key],
          ticket,
          result
        ),
      }));
    },
    []
  );

  const readRegistry = useCallback(async () => {
    const t = {
      effective: seqs.current.effective.issue(),
      defaults: seqs.current.defaults.issue(),
    };
    const [effective, defaults] = await Promise.allSettled([
      listAgentRegistry(COORD_DASHBOARD_POLL_OPTIONS),
      listAdminAgentRegistry(COORD_DASHBOARD_POLL_OPTIONS),
    ]);
    apply("effective", t.effective, effective);
    apply("defaults", t.defaults, defaults);
    return { effective, defaults };
  }, [apply]);

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      const tNext = seqs.current.nextStep.issue();
      const [, nextStep] = await Promise.all([
        readRegistry(),
        Promise.allSettled([
          fetchNextStepSettings(COORD_DASHBOARD_POLL_OPTIONS),
        ]).then(([r]) => r!),
      ]);
      if (!isCurrent()) return;
      apply("nextStep", tNext, nextStep);
    },
    [apply, readRegistry]
  );

  const { refresh: refreshReads } = useSingleFlightPoll(poll, SWITCHES_POLL_MS);

  // The follow-up scopes carry no as-of of their own: they are dated when a
  // pass of the hook ends with the repo list read — never by a pass that failed.
  const followupDone = !followup.loading;
  const followupAnswered =
    followup.repos !== null && followup.reposError === null;
  useEffect(() => {
    if (followupDone && followupAnswered) setFollowupAsOfMs(Date.now());
  }, [followupDone, followupAnswered, followup.readings]);

  // The merge settings are dated the same way: when a load ends answered.
  const [mergeSettingsAsOfMs, setMergeSettingsAsOfMs] = useState<number | null>(
    null
  );
  const mergeAnswered =
    !dial.loading && dial.error === null && dial.profile !== null;
  useEffect(() => {
    if (mergeAnswered) setMergeSettingsAsOfMs(Date.now());
  }, [mergeAnswered, dial.profile]);

  const { reload: reloadFollowup } = followup;
  const { reload: reloadDial } = dial;
  const refresh = useCallback(async () => {
    await Promise.all([refreshReads(), reloadFollowup(), reloadDial()]);
  }, [refreshReads, reloadFollowup, reloadDial]);

  const record = useCallback((key: string, write: SwitchWrite) => {
    setWrites((prev) => ({ ...prev, [key]: write }));
  }, []);

  /** Run one write to `key`, refusing a second while the first reads back. */
  const exclusive = useCallback(
    async (key: string, run: () => Promise<void>) => {
      if (inFlight.current.has(key)) throw new Error(WRITE_IN_FLIGHT);
      inFlight.current.add(key);
      try {
        await run();
      } finally {
        inFlight.current.delete(key);
      }
    },
    []
  );

  const setRegistryDefault = useCallback(
    (agentName: string, enabled: boolean) => {
      const key = `registry:${agentName}`;
      return exclusive(key, async () => {
        const asked = enabled ? "on" : "off";
        record(key, {
          asked,
          phase: "writing",
          error: null,
          readbackError: null,
        });
        try {
          await putAgentRegistryDefaults(agentName, {
            default_enabled: enabled,
          });
        } catch (err) {
          record(key, {
            asked,
            phase: "refused",
            error: switchReadErrorText(err),
            readbackError: null,
          });
          return;
        }
        // The read-back: the tenant default (what coord enforces), re-read
        // AFTER the write landed.
        const { defaults } = await readRegistry();
        record(key, {
          asked,
          phase: "written",
          error: null,
          readbackError:
            defaults.status === "rejected"
              ? switchReadErrorText(defaults.reason)
              : null,
        });
      });
    },
    [exclusive, readRegistry, record]
  );

  const setAutonomyLevel = useCallback(
    (domain: string, level: AutonomyLevel) => {
      const key = `autonomy:${domain}`;
      return exclusive(key, async () => {
        record(key, {
          asked: level,
          phase: "writing",
          error: null,
          readbackError: null,
        });
        let answered: NextStepSettings;
        try {
          answered = await putNextStepSettings([
            { decision_domain: domain, autonomy_level: level },
          ]);
        } catch (err) {
          record(key, {
            asked: level,
            phase: "refused",
            error: switchReadErrorText(err),
            readbackError: null,
          });
          return;
        }
        // Coord's PUT answers its authoritative state after the write: applied
        // as a read, ticketed now so an older poll cannot paint over it.
        const ticket = seqs.current.nextStep.issue();
        apply("nextStep", ticket, { status: "fulfilled", value: answered });
        record(key, {
          asked: level,
          phase: "written",
          error: null,
          readbackError: null,
        });
      });
    },
    [apply, exclusive, record]
  );

  /** Record a write whose outcome is unknown, then the re-read that settles it. */
  const settleUnconfirmed = useCallback(
    async (
      key: string,
      asked: string,
      reason: string,
      reread: Promise<AutoFixPrReread>
    ) => {
      record(key, {
        asked,
        phase: "unconfirmed",
        error: reason,
        readbackError: null,
      });
      const r = await reread;
      record(key, {
        asked,
        phase: "written",
        error: null,
        readbackError: r.ok ? null : r.error,
        outcomeUnknown: true,
      });
    },
    [record]
  );

  const { setChoice } = dial;
  const setFixerDial = useCallback(
    (choice: AutoFixPrChoice) => {
      const key = "dial:auto_fix_pr";
      return exclusive(key, async () => {
        record(key, {
          asked: choice,
          phase: "writing",
          error: null,
          readbackError: null,
        });
        const outcome = await setChoice(choice);
        switch (outcome.kind) {
          case "saved":
            // The hook applied coord's answer, which read back what was sent.
            record(key, {
              asked: choice,
              phase: "written",
              error: null,
              readbackError: null,
            });
            return;
          case "refused":
            record(key, {
              asked: choice,
              phase: "refused",
              error: outcome.message,
              readbackError: null,
            });
            return;
          case "unconfirmed":
            await settleUnconfirmed(
              key,
              choice,
              outcome.reason,
              outcome.reread
            );
            return;
          case "busy":
            // Nothing was sent: the hook's own write is still in flight.
            record(key, {
              asked: choice,
              phase: "refused",
              error: WRITE_IN_FLIGHT,
              readbackError: null,
            });
            return;
        }
      });
    },
    [exclusive, record, setChoice, settleUnconfirmed]
  );

  const setRedMainKnob = useCallback(
    (enabled: boolean) => {
      const key = "knob:auto_fix_red_main";
      return exclusive(key, async () => {
        const asked = enabled ? "on" : "off";
        record(key, {
          asked,
          phase: "writing",
          error: null,
          readbackError: null,
        });
        try {
          await patchTenantAutoFixRedMain(enabled);
        } catch (err) {
          const message = switchReadErrorText(err);
          if (isUnconfirmedWrite(message)) {
            await settleUnconfirmed(key, asked, message, reloadDial());
            return;
          }
          record(key, {
            asked,
            phase: "refused",
            error: message,
            readbackError: null,
          });
          return;
        }
        // The read-back: the merge settings, re-read AFTER the write landed.
        const r = await reloadDial();
        record(key, {
          asked,
          phase: "written",
          error: null,
          readbackError: r.ok ? null : r.error,
        });
      });
    },
    [exclusive, record, reloadDial, settleUnconfirmed]
  );

  const mergeSettings = useMemo<MergeSettingsRead>(
    () => ({
      loading: dial.loading,
      error: dial.error,
      dial: dial.state,
      profile: dial.profile,
    }),
    [dial.loading, dial.error, dial.state, dial.profile]
  );
  const followupRead = useMemo<FollowupRead>(
    () => ({
      loading: followup.loading,
      repos: followup.repos,
      reposError: followup.reposError,
      readings: followup.readings,
    }),
    [followup.loading, followup.repos, followup.reposError, followup.readings]
  );

  return {
    ...parts,
    mergeSettings,
    followup: followupRead,
    followupAsOfMs,
    mergeSettingsAsOfMs,
    writes,
    refresh,
    setRegistryDefault,
    setAutonomyLevel,
    setFixerDial,
    setRedMainKnob,
  };
}
