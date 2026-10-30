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
 * - On either PUT, a failure that leaves the outcome open (the backend's 504,
 *   which it documents as "coord may well have committed, and only a re-read
 *   can tell", the client's own timeout, or a failure with no HTTP status) is
 *   not a refusal: it is UNKNOWN until a re-read settles it, like the two below.
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
 *
 * Each setter resolves with how the write ended (`SwitchWriteResult`), for a
 * caller that cannot see the matrix; it records the value of the read it
 * settled on, so a later read that differs is not taken for this write's
 * read-back. When the read-back itself failed, the first read to answer after
 * it is the one the write settles on.
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
import {
  patchTenantAutoFixRedMain,
  type EffectiveProfile,
} from "@/lib/api/operations/prMerge";
import {
  useAutoFixPrSetting,
  type AutoFixPrReread,
} from "@/app/(app)/settings/coordination/_hooks/useAutoFixPrSetting";
import {
  choiceFromTenant,
  isUnconfirmedFailure,
  readAutoFixPr,
  type AutoFixPrChoice,
} from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import { useRepoFollowupDials } from "@/app/(app)/admin/coord/agent-registry/_hooks/useRepoFollowupDials";
import {
  switchWriteResult,
  type FollowupRead,
  type MergeSettingsRead,
  type ReadPart,
  type SwitchWrite,
  type SwitchWriteResult,
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

/** Why coord refused a write, in the operator's words. */
function switchWriteErrorText(err: unknown): string {
  if (err instanceof AgentPrefError && err.status === 403) {
    return "only a coord tenant admin of the active project may change it (HTTP 403)";
  }
  return switchReadErrorText(err);
}

/** The refusal a second write to a switch gets while its first is reading back. */
export const WRITE_IN_FLIGHT =
  "A write to this switch is still in flight; wait for its read-back.";

/**
 * Whether a failed registry or next-step PUT may still have landed. Both doors
 * answer 504 when the request may have been sent and they hold no usable answer
 * (a timeout, an answer lost in transit, a 2xx body that is not JSON), and a
 * client timeout or a failure with no HTTP status is the same state. An offline
 * browser is taken as not having sent it.
 *
 * Every other status is shown as a refusal, which for a 502 is a reading, not a
 * proof. A door's own 502 means no connection was made (the registry door also
 * answers one for a coord that does not serve the route), but a 502 from coord
 * or from a gateway in front of it passes through unchanged, and whether a
 * gateway can answer one after forwarding the PUT has not been established.
 */
function writeMayHaveLanded(err: unknown): boolean {
  if (err instanceof AgentPrefError) return err.status === 504;
  return isUnconfirmedFailure(err);
}

function unconfirmedReason(err: unknown): string {
  return err instanceof AgentPrefError
    ? `coord's answer did not arrive (HTTP ${err.status}), so it may have landed`
    : switchReadErrorText(err);
}

/** A re-read after a write: the value it gave the switch, or why it failed. */
type SwitchReread =
  | { ok: true; state: string | null }
  | { ok: false; error: string };

function onOff(value: unknown): string | null {
  return typeof value === "boolean" ? (value ? "on" : "off") : null;
}

function registryState(
  rows: readonly AdminAgentRegistryRow[] | null,
  agentName: string
): string | null {
  return onOff(rows?.find((r) => r.agent_name === agentName)?.default_enabled);
}

function autonomyState(
  settings: NextStepSettings | null,
  domain: string
): string | null {
  return (
    settings?.domains.find((d) => d.decision_domain === domain)
      ?.autonomy_level ?? null
  );
}

function dialState(profile: EffectiveProfile | null): string | null {
  const dial = readAutoFixPr(profile);
  return dial === null ? null : choiceFromTenant(dial.tenant);
}

function redMainState(profile: EffectiveProfile | null): string | null {
  return onOff(profile?.auto_fix_red_main);
}

/** What the reads now answered give one switch, by its write key. */
function stateOfSwitch(
  key: string,
  reads: {
    defaults: readonly AdminAgentRegistryRow[] | null;
    nextStep: NextStepSettings | null;
    profile: EffectiveProfile | null;
  }
): string | null {
  const [door, name = ""] = key.split(/:(.*)/s);
  switch (door) {
    case "registry":
      return registryState(reads.defaults, name);
    case "autonomy":
      return autonomyState(reads.nextStep, name);
    case "dial":
      return dialState(reads.profile);
    case "knob":
      return redMainState(reads.profile);
    default:
      return null;
  }
}

function mergeReread(
  read: AutoFixPrReread,
  stateOf: (profile: EffectiveProfile | null) => string | null
): SwitchReread {
  return read.ok ? { ok: true, state: stateOf(read.profile) } : read;
}

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
  setRegistryDefault: (
    agentName: string,
    enabled: boolean
  ) => Promise<SwitchWriteResult>;
  setAutonomyLevel: (
    domain: string,
    level: AutonomyLevel
  ) => Promise<SwitchWriteResult>;
  setFixerDial: (choice: AutoFixPrChoice) => Promise<SwitchWriteResult>;
  setRedMainKnob: (enabled: boolean) => Promise<SwitchWriteResult>;
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

  // What the reads hold now, for a setter whose write coord refused: the value
  // it stays on. Updated after each commit, read only from event handlers.
  const latest = useRef<{
    defaults: AdminAgentRegistryRow[] | null;
    nextStep: NextStepSettings | null;
    profile: EffectiveProfile | null;
  }>({ defaults: null, nextStep: null, profile: null });
  useEffect(() => {
    latest.current = {
      defaults: parts.defaults.data,
      nextStep: parts.nextStep.data,
      profile: dial.profile,
    };
  }, [parts.defaults.data, parts.nextStep.data, dial.profile]);

  const record = useCallback((key: string, write: SwitchWrite) => {
    setWrites((prev) => ({ ...prev, [key]: write }));
  }, []);

  // A write whose read-back failed settles on the first read that answers: the
  // read the cell stops being UNKNOWN on. Without this nothing would ever mark a
  // later read as later, and another operator's change would read as coord
  // contradicting this write. A kept value (a stale part, a dial with no answer)
  // settles nothing.
  const answeredDefaults =
    parts.defaults.error === null ? parts.defaults.data : null;
  const answeredNextStep =
    parts.nextStep.error === null ? parts.nextStep.data : null;
  const answeredProfile = mergeAnswered ? dial.profile : null;
  useEffect(() => {
    const settled = Object.entries(writes).flatMap(([key, write]) => {
      if (
        write.phase !== "written" ||
        write.readbackError === null ||
        (write.settledState !== undefined && write.settledState !== null)
      ) {
        return [];
      }
      const state = stateOfSwitch(key, {
        defaults: answeredDefaults,
        nextStep: answeredNextStep,
        profile: answeredProfile,
      });
      return state === null ? [] : [{ key, write, state }];
    });
    if (settled.length === 0) return;
    setWrites((prev) => {
      const next = { ...prev };
      for (const { key, write, state } of settled) {
        // Only the record this read was compared with: a newer write replaces it.
        if (prev[key] === write) next[key] = { ...write, settledState: state };
      }
      return next;
    });
  }, [writes, answeredDefaults, answeredNextStep, answeredProfile]);

  /** Record how a write ended, and answer it to the caller. */
  const finish = useCallback(
    (key: string, write: SwitchWrite): SwitchWriteResult => {
      record(key, write);
      return switchWriteResult(write);
    },
    [record]
  );

  /** Run one write to `key`, refusing a second while the first reads back. */
  const exclusive = useCallback(
    async (
      key: string,
      run: () => Promise<SwitchWriteResult>
    ): Promise<SwitchWriteResult> => {
      if (inFlight.current.has(key)) throw new Error(WRITE_IN_FLIGHT);
      inFlight.current.add(key);
      try {
        return await run();
      } finally {
        inFlight.current.delete(key);
      }
    },
    []
  );

  /** A write that came back with no answer: UNKNOWN until `reread` settles it. */
  const settleUnconfirmed = useCallback(
    async (
      key: string,
      asked: string,
      reason: string,
      reread: Promise<SwitchReread>
    ): Promise<SwitchWriteResult> => {
      record(key, {
        asked,
        phase: "unconfirmed",
        error: reason,
        readbackError: null,
      });
      const r = await reread;
      return finish(key, {
        asked,
        phase: "written",
        error: null,
        readbackError: r.ok ? null : r.error,
        settledState: r.ok ? r.state : null,
        outcomeUnknown: true,
      });
    },
    [finish, record]
  );

  /** The tenant defaults, re-read AFTER a write: what coord enforces. */
  const rereadDefaults = useCallback(
    async (agentName: string): Promise<SwitchReread> => {
      const { defaults } = await readRegistry();
      return defaults.status === "fulfilled"
        ? { ok: true, state: registryState(defaults.value, agentName) }
        : { ok: false, error: switchReadErrorText(defaults.reason) };
    },
    [readRegistry]
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
          if (writeMayHaveLanded(err)) {
            return settleUnconfirmed(
              key,
              asked,
              unconfirmedReason(err),
              rereadDefaults(agentName)
            );
          }
          return finish(key, {
            asked,
            phase: "refused",
            error: switchWriteErrorText(err),
            readbackError: null,
            settledState: registryState(latest.current.defaults, agentName),
          });
        }
        const r = await rereadDefaults(agentName);
        return finish(key, {
          asked,
          phase: "written",
          error: null,
          readbackError: r.ok ? null : r.error,
          settledState: r.ok ? r.state : null,
        });
      });
    },
    [exclusive, finish, record, rereadDefaults, settleUnconfirmed]
  );

  /** The next-step settings, re-read after a write coord did not answer. */
  const rereadNextStep = useCallback(
    async (domain: string): Promise<SwitchReread> => {
      const ticket = seqs.current.nextStep.issue();
      const [read] = await Promise.allSettled([
        fetchNextStepSettings(COORD_DASHBOARD_POLL_OPTIONS),
      ]);
      apply("nextStep", ticket, read);
      return read.status === "fulfilled"
        ? { ok: true, state: autonomyState(read.value, domain) }
        : { ok: false, error: switchReadErrorText(read.reason) };
    },
    [apply]
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
          if (writeMayHaveLanded(err)) {
            return settleUnconfirmed(
              key,
              level,
              unconfirmedReason(err),
              rereadNextStep(domain)
            );
          }
          return finish(key, {
            asked: level,
            phase: "refused",
            error: switchWriteErrorText(err),
            readbackError: null,
            settledState: autonomyState(latest.current.nextStep, domain),
          });
        }
        // Coord's PUT answers its authoritative state after the write: applied
        // as a read, ticketed now so an older poll cannot paint over it.
        const ticket = seqs.current.nextStep.issue();
        apply("nextStep", ticket, { status: "fulfilled", value: answered });
        return finish(key, {
          asked: level,
          phase: "written",
          error: null,
          readbackError: null,
          settledState: autonomyState(answered, domain),
        });
      });
    },
    [apply, exclusive, finish, record, rereadNextStep, settleUnconfirmed]
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
            return finish(key, {
              asked: choice,
              phase: "written",
              error: null,
              readbackError: null,
              settledState: choice,
            });
          case "refused":
            return finish(key, {
              asked: choice,
              phase: "refused",
              error: outcome.message,
              readbackError: null,
              settledState: dialState(latest.current.profile),
            });
          case "unconfirmed":
            return settleUnconfirmed(
              key,
              choice,
              outcome.reason,
              outcome.reread.then((r) => mergeReread(r, dialState))
            );
          case "busy":
            // Nothing was sent: the hook's own write is still in flight.
            return finish(key, {
              asked: choice,
              phase: "refused",
              error: WRITE_IN_FLIGHT,
              readbackError: null,
              settledState: dialState(latest.current.profile),
            });
        }
      });
    },
    [exclusive, finish, record, setChoice, settleUnconfirmed]
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
          if (isUnconfirmedFailure(err)) {
            return settleUnconfirmed(
              key,
              asked,
              message,
              reloadDial().then((r) => mergeReread(r, redMainState))
            );
          }
          return finish(key, {
            asked,
            phase: "refused",
            error: message,
            readbackError: null,
            settledState: redMainState(latest.current.profile),
          });
        }
        // The read-back: the merge settings, re-read AFTER the write landed.
        const r = mergeReread(await reloadDial(), redMainState);
        return finish(key, {
          asked,
          phase: "written",
          error: null,
          readbackError: r.ok ? null : r.error,
          settledState: r.ok ? r.state : null,
        });
      });
    },
    [exclusive, finish, record, reloadDial, settleUnconfirmed]
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
