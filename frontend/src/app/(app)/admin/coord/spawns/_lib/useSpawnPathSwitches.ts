"use client";

/**
 * The reads and writes behind the spawn-path matrix.
 *
 * Every read is an EXISTING door, through its existing client — never coord
 * from the browser:
 *
 * | read | door | client |
 * |---|---|---|
 * | coord's effective registry (the fold coord serves) | `GET /api/v1/agent-registry` → `/coord/agent-registry/effective-for` | `listAgentRegistry` |
 * | the tenant defaults the switches move | `GET /api/v1/agent-registry/admin/registry` → `/coord/agent-registry` | `listAdminAgentRegistry` |
 * | the autonomy levels and fleet flags | `GET /api/v1/operations/coord/next-step-settings` | `fetchNextStepSettings` |
 * | the PR fixer dial | `GET /api/v1/operations/pr-merge/settings` | `useAutoFixPrSetting` (the settings page's hook) |
 * | the per-repo follow-up scopes and their rollout mode | `GET /api/v1/operations/post-merge-followup-scope` | `useRepoFollowupDials` (the agent registry page's hook) |
 *
 * The first three poll together, single-flight with no retries (the next tick
 * is the retry), each ordered by its own `ReadSequence`: a read that finishes
 * after a newer one delivered never paints over it, and a failed read keeps
 * the last good answer, labelled stale.
 *
 * ## Writes, and what is shown after one
 *
 * Each write goes through its existing door — `PUT /coord/agent-registry/
 * :agent_name` (`putAgentRegistryDefaults`), `PUT /coord/next-step-settings`
 * (`putNextStepSettings`), `PATCH /pr-merge/settings` (the dial hook's
 * `setChoice`) — and records what was ASKED (`SwitchWrite`). What the matrix
 * then shows is the READ-BACK: a registry write re-reads the effective row and
 * the defaults (its ticket taken when the PUT resolves, so a poll issued
 * before it cannot paint the pre-write value over it); the next-step PUT
 * answers coord's authoritative state, which is applied as a read; the dial
 * hook applies coord's PATCH answer, or reloads when that answer does not
 * confirm. The asked value itself is never rendered as the value — the gate
 * compares the read with it (`spawnPathGates.ts`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReadSequence, type ReadSequence } from "@/components/console";
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
import { useAutoFixPrSetting } from "@/app/(app)/settings/coordination/_hooks/useAutoFixPrSetting";
import type { AutoFixPrChoice } from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import { useRepoFollowupDials } from "@/app/(app)/admin/coord/agent-registry/_hooks/useRepoFollowupDials";
import type {
  AutoFixPrRead,
  FollowupRead,
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

export interface SpawnPathSwitches {
  effective: ReadPart<AgentRegistryEntry[]>;
  defaults: ReadPart<AdminAgentRegistryRow[]>;
  nextStep: ReadPart<NextStepSettings>;
  autoFixPr: AutoFixPrRead;
  followup: FollowupRead;
  /** When the follow-up scopes were last answered (they carry no as-of). */
  followupAsOfMs: number | null;
  /** When the merge-settings dial was last answered (it carries no as-of). */
  dialAsOfMs: number | null;
  writes: Readonly<Record<string, SwitchWrite>>;
  /** Re-read every source now. */
  refresh: () => Promise<void>;
  setRegistryDefault: (agentName: string, enabled: boolean) => Promise<void>;
  setAutonomyLevel: (domain: string, level: AutonomyLevel) => Promise<void>;
  setFixerDial: (choice: AutoFixPrChoice) => Promise<void>;
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
      listAgentRegistry(),
      listAdminAgentRegistry(),
    ]);
    apply("effective", t.effective, effective);
    apply("defaults", t.defaults, defaults);
    return effective;
  }, [apply]);

  const poll = useCallback(
    async (isCurrent: () => boolean) => {
      const tNext = seqs.current.nextStep.issue();
      const [, nextStep] = await Promise.all([
        readRegistry(),
        Promise.allSettled([fetchNextStepSettings()]).then(([r]) => r!),
      ]);
      if (!isCurrent()) return;
      apply("nextStep", tNext, nextStep);
    },
    [apply, readRegistry]
  );

  const { refresh: refreshReads } = useSingleFlightPoll(
    poll,
    SWITCHES_POLL_MS
  );

  // The follow-up scopes carry no as-of of their own: they are dated when a
  // pass of the hook ends with the repo list read — never by a pass that failed.
  const followupDone = !followup.loading;
  const followupAnswered = followup.repos !== null && followup.reposError === null;
  useEffect(() => {
    if (followupDone && followupAnswered) setFollowupAsOfMs(Date.now());
  }, [followupDone, followupAnswered, followup.readings]);

  // The dial is dated the same way: when a load ends with the dial read.
  const [dialAsOfMs, setDialAsOfMs] = useState<number | null>(null);
  const dialAnswered = !dial.loading && dial.error === null && dial.state !== null;
  useEffect(() => {
    if (dialAnswered) setDialAsOfMs(Date.now());
  }, [dialAnswered, dial.state]);

  const { reload: reloadFollowup } = followup;
  const { reload: reloadDial } = dial;
  const refresh = useCallback(async () => {
    reloadDial();
    await Promise.all([refreshReads(), reloadFollowup()]);
  }, [refreshReads, reloadFollowup, reloadDial]);

  const record = useCallback((key: string, write: SwitchWrite) => {
    setWrites((prev) => ({ ...prev, [key]: write }));
  }, []);

  const setRegistryDefault = useCallback(
    async (agentName: string, enabled: boolean) => {
      const key = `registry:${agentName}`;
      const asked = enabled ? "on" : "off";
      record(key, { asked, phase: "writing", error: null, readbackError: null });
      try {
        await putAgentRegistryDefaults(agentName, { default_enabled: enabled });
      } catch (err) {
        record(key, {
          asked,
          phase: "refused",
          error: switchReadErrorText(err),
          readbackError: null,
        });
        return;
      }
      // The read-back: coord's effective row, re-read AFTER the write landed.
      const effective = await readRegistry();
      record(key, {
        asked,
        phase: "written",
        error: null,
        readbackError:
          effective.status === "rejected"
            ? switchReadErrorText(effective.reason)
            : null,
      });
    },
    [readRegistry, record]
  );

  const setAutonomyLevel = useCallback(
    async (domain: string, level: AutonomyLevel) => {
      const key = `autonomy:${domain}`;
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
    },
    [apply, record]
  );

  const { setChoice } = dial;
  const setFixerDial = useCallback(
    async (choice: AutoFixPrChoice) => {
      const key = "dial:auto_fix_pr";
      record(key, {
        asked: choice,
        phase: "writing",
        error: null,
        readbackError: null,
      });
      // The hook applies coord's PATCH answer only when it reads back what was
      // sent, and reloads otherwise; the gate compares that with `choice`.
      await setChoice(choice);
      record(key, {
        asked: choice,
        phase: "written",
        error: null,
        readbackError: null,
      });
    },
    [record, setChoice]
  );

  const autoFixPr = useMemo<AutoFixPrRead>(
    () => ({ loading: dial.loading, error: dial.error, state: dial.state }),
    [dial.loading, dial.error, dial.state]
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
    autoFixPr,
    followup: followupRead,
    followupAsOfMs,
    dialAsOfMs,
    writes,
    refresh,
    setRegistryDefault,
    setAutonomyLevel,
    setFixerDial,
  };
}
