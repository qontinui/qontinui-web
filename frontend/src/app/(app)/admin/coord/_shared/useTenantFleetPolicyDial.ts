"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchFleetPolicy,
  putFleetPolicy,
  type FleetPolicyView,
  type FleetPolicyWriteResult,
} from "@/lib/api/operations/tenantPolicy";
import {
  rereadAfterFailedReadBack,
  resolvedOtherwise,
} from "./fleetPolicyReadBack";
import {
  useFirstPinnedRead,
  useSendTimePin,
  type SendTimePinOptions,
} from "./useSendTimePin";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One tenant-band fleet-policy dial — read the RESOLVED value, write a new
 * level, then read it back. Shared by every tenant-band dial in the console
 * (`plan_capture` and `citation_scope_backfill_write` on the plan library;
 * `policy_write` and `policy_upstream` on prompt documents;
 * `command_safety_rewrite`, `permission_prompt_capture`,
 * `permission_auto_accept`, `account_selection_mode` and `image_generation`
 * on tenant policy;
 * `github_hosted_ci` on Dev Ops ▸ CI). Each domain's hook binds `domain` +
 * `label` and layers its own level vocabulary on top (a no-row default, a
 * fail-closed parse), so the honesty properties below are
 * stated and tested once rather than drifting between copies — the four used
 * to be hand-copied, and the refresh-vs-write race fix reached only two.
 *
 * Three properties this hook exists to hold:
 *
 * 1. **What is displayed is what devices resolve, never what was written.**
 *    Coord folds `master_enabled` in and lets a more specific scope band win,
 *    so a successful write does not entail the value the fleet sees. Every
 *    state transition here comes from a READ (`policy`), and the write's own
 *    echo is kept separately (`lastWrite`) so the two can be compared rather
 *    than conflated.
 *
 * 2. **A failed read-back is UNKNOWN.** When the backend reports
 *    `readback_error`, this does NOT optimistically set the new level — it
 *    keeps the last known-good value and surfaces `readbackError`. Painting
 *    the written level on an unconfirmed write is exactly how a toggle starts
 *    lying about the fleet. A caller that pins its requests reads again at
 *    once, pinned, so the value shown becomes coord's, and says what a
 *    read-back would: "now X" when coord resolves the level written, the
 *    read-back's warning when it does not (`rereadAfterFailedReadBack`). One
 *    that pins nothing waits for a refresh. A failed READ likewise keeps the
 *    last known-good value: blanking it would render as "off", a claim we
 *    cannot make.
 *
 * 3. **Scope band is tenant-wide, and that is a decision, not a default.** Every
 *    dial bound here is decided with no repo in hand: the capture clause is
 *    baked into a runner's briefing once per session at spawn (a session is
 *    not repo-scoped), the citation backfill agent door operates on the
 *    caller's whole tenant, and `policy_write` / `policy_upstream` govern the
 *    tenant's prompt documents, which belong to no repo, and the runner picks
 *    a session's `command_safety_rewrite` and `permission_prompt_capture`
 *    carrier at spawn, before the session is scoped to any repo, the runner
 *    answers a session's `permission_auto_accept` prompts for that same
 *    unscoped session, and `account_selection_mode` is a machine-global mode
 *    on a machine that is not repo-scoped. A `repo` band would
 *    have no resolvable `scope_key` at the moment any of those decisions is
 *    made, so the hook offers no per-repo write. It still SHOWS the resolved band, because the band that won tells
 *    the operator whether this tenant's row is the one in force. The two
 *    domains that ARE decided with a repo in hand — `github_hosted_ci` (a CI
 *    run belongs to a repo) and `image_generation` (studio names the repo it is
 *    generating for) — bind this hook for their TENANT band only, and write
 *    their repo band through the sibling `useRepoFleetPolicyWrite`.
 *
 * **A page that shows one project's data can pin every request to it.** With
 * `resolvePin`, the read and the write are each sent in the project it names
 * when the request goes out, on every attempt — so a write re-issued after a
 * 429, or replayed after a token refresh, once another tab has switched
 * project still lands in the project the page shows. Such a page reads
 * nothing until the resolver names a project: the first read goes out then
 * (`useFirstPinnedRead`), and a later read with no project named sends
 * nothing; `waitingForProject` says the dial is waiting. Its write reads the
 * pin once, beside the send, and is refused there when none is named, so it
 * never goes out unpinned. Omitted, every request is sent exactly as before:
 * in the project stored when it is made, the read on mount.
 *
 * Coord resolves **most-specific-wins**: `repo` beats `tenant` beats `system`
 * (`resolve_effective` picks the lowest `ScopeBand` ordinal, Repo=0 < Tenant=1
 * < System=2). So a `repo` band winning means a narrower row is overriding the
 * tenant row, while a `system` band winning means this tenant has NO row at all
 * — writing one here will take effect. Getting that backwards would tell the
 * operator a write is futile in precisely the case where it wins.
 *
 * @param domain  the fleet-policy domain coord stores the row under.
 * @param label   lower-case human name for toasts and the change note
 *                ("plan capture").
 * @param resolvers who resolves the level, WITH its verb, for the read-back's
 *                sentences — "devices resolve" for a briefing clause, "agents
 *                resolve" for an agent door, "coord resolves" for a level
 *                coord applies itself. Each caller states its own verb, so a
 *                singular subject reads "coord resolves", never "coord
 *                resolve".
 * @param options `resolvePin`, asked at send time (see above).
 */
export function useTenantFleetPolicyDial<L extends string>(
  domain: string,
  label: string,
  resolvers: string = "devices resolve",
  { resolvePin }: SendTimePinOptions = {}
) {
  // One identity whatever the caller passes, so the first read runs once: the
  // pin is read as each request goes out.
  const sendPin = useSendTimePin(resolvePin);
  // A caller that passes a resolver reads only under the project it names.
  const pinsReads = resolvePin !== undefined;
  const pinsReadsRef = useRef(pinsReads);
  pinsReadsRef.current = pinsReads;
  const [policy, setPolicy] = useState<FleetPolicyView | null>(null);
  // Loading only once a read goes out: not while waiting for a project.
  const [loading, setLoading] = useState(
    () => !pinsReads || sendPin() !== undefined
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastWrite, setLastWrite] = useState<FleetPolicyWriteResult | null>(
    null
  );
  // Bumped when a write LANDS. A read that began before the latest landed
  // write may resolve after that write's read-back; applying it would paint an
  // older value over the confirmed one and clear the read-back warning. A
  // rejected write changes nothing, so it does not bump — otherwise a Refresh
  // in flight beside it would be silently discarded.
  const writeGeneration = useRef(0);

  /**
   * Read the resolved value: the view when THIS read landed and is now what
   * is shown, else `null` — it failed, sent nothing, or a write landed while
   * it was in flight and it was discarded.
   */
  const read = useCallback(async (): Promise<FleetPolicyView | null> => {
    const pin = sendPin();
    // No project named yet: nothing is sent, and what is shown stays.
    if (pinsReadsRef.current && pin === undefined) return null;
    const generation = writeGeneration.current;
    try {
      setLoading(true);
      const view = await fetchFleetPolicy(domain, undefined, pin);
      if (generation !== writeGeneration.current) return null;
      setPolicy(view);
      setError(null);
      // A confirmed read retires the previous write's read-back failure. The
      // banner it drives says "the value above may be stale" — leaving it up
      // beside a value we just confirmed would be the opposite of honest.
      setLastWrite(null);
      return view;
    } catch (err) {
      if (generation !== writeGeneration.current) return null;
      // Keep the last known-good value on screen; the banner says it is stale.
      // Blanking it would read as "off", which is a claim we cannot make.
      setError(message(err, `Failed to read the ${label} dial`));
      return null;
    } finally {
      setLoading(false);
    }
  }, [domain, label, sendPin]);

  /**
   * Read the resolved value. Resolves `true` only when THIS read landed and is
   * now what is shown — `false` when it failed, or when a write landed while it
   * was in flight and it was discarded — so a caller can tell a confirmed read
   * from a refresh that confirmed nothing.
   */
  const load = useCallback(
    async (): Promise<boolean> => (await read()) !== null,
    [read]
  );

  // A caller that pins nothing reads on mount, as it always has; one that
  // pins its requests reads first when its project is known.
  useEffect(() => {
    if (!pinsReadsRef.current) load();
  }, [load]);
  const waiting = useFirstPinnedRead(sendPin, () => void load());

  /**
   * A write to this domain LANDED outside this hook — a repo-band write whose
   * effect shows up in this read (`repo_overrides`). Retires every read that
   * began before it, exactly as a landed tenant write does; call it the moment
   * the write lands, before re-reading, so the re-read is the one applied.
   */
  const noteWriteLanded = useCallback(() => {
    writeGeneration.current += 1;
  }, []);

  /**
   * Write `level` at the tenant band.
   *
   * `master_enabled` is always `true`: coord resolves `effective_level = off`
   * whenever the master is false, so a control that also flipped the master
   * would have two different spellings of "off" and no way for the operator
   * to tell which one is in force. The level alone carries the state.
   */
  const setLevel = useCallback(
    async (level: L, changeNote?: string): Promise<boolean> => {
      // The project the write is sent in, read once beside the send. A
      // caller that pins its requests sends no write without one, whatever
      // it checked before calling: nothing would hold the write to its page.
      const pin = sendPin();
      if (pinsReadsRef.current && pin === undefined) {
        toast.error(
          `Nothing was sent: there is no project to send the ${label} ` +
            "change in. Select a project, or reload the page."
        );
        return false;
      }
      try {
        setSaving(true);
        const result = await putFleetPolicy(
          {
            domain,
            scope_band: "tenant",
            scope_key: null,
            level,
            master_enabled: true,
            change_note:
              changeNote ?? `Set ${label} to "${level}" from the console`,
          },
          pin
        );
        writeGeneration.current += 1;
        setLastWrite(result);
        const confirmed = `${capitalise(label)}: now "${level}" for this tenant.`;

        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          if (result.effective.effective_level === level) {
            toast.success(confirmed);
          } else {
            // A write that landed and a value that resolves are different
            // facts. Say which one the fleet is actually on.
            toast.warning(
              resolvedOtherwise(level, resolvers, result.effective)
            );
          }
        } else {
          // Written, but unconfirmed. Leave `policy` alone — do NOT paint the
          // written level as though it were resolved.
          toast.warning(
            `The write went through, but the read-back failed — what ${resolvers} ` +
              "is unknown until this refreshes."
          );
          // A caller that pins its requests reads it again, pinned, so what
          // is shown is coord's level and not the one from before the write,
          // and says what the read-back would have. A failed re-read keeps
          // both the value and the warning.
          if (pinsReadsRef.current) {
            void rereadAfterFailedReadBack({
              read,
              level,
              confirmed,
              resolvers,
              onError: (err) =>
                setError(message(err, `Failed to read the ${label} dial`)),
            });
          }
        }
        return true;
      } catch (err) {
        toast.error(message(err, `Failed to write the ${label} dial`));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [domain, label, resolvers, sendPin, read]
  );

  return {
    policy,
    loading,
    /**
     * A caller that pins its requests, before its resolver names a project:
     * nothing has been read, and nothing is shown as read. Always `false`
     * for a caller that passes no resolver.
     */
    waitingForProject: pinsReads && waiting,
    saving,
    error,
    /** Set only when the last write's read-back failed. UNKNOWN, not "off". */
    readbackError: lastWrite?.readback_error ?? null,
    lastWrite,
    /** Re-read; resolves `true` only when that read landed and is now shown. */
    reload: load,
    setLevel,
    /** A write to this domain landed elsewhere: retire reads that began before it. */
    noteWriteLanded,
  };
}
