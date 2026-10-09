"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { putFleetPolicy } from "@/lib/api/operations/coordFleet";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Coord's typed refusals for a fleet-policy write, in operator words.
 *
 * Coord's `PUT /coord/fleet-policy` answers 400 with `{"error": <code>}`; the
 * web proxy relays the body and `httpClient` folds it into the error message,
 * so the code is recovered from the message text. A refusal coord NAMED is a
 * fact about the request ("that repo is not yours"), and rendering it as a
 * generic failure would send the operator looking for an outage.
 */
const WRITE_REFUSALS: Readonly<Record<string, string>> = {
  repo_not_in_tenant:
    "coord refused: this repo is not one of this tenant's repos, so it cannot carry an override here",
  unknown_level: "coord refused: that level is not one this setting accepts",
  repo_key_not_owner_name:
    "coord refused: a repo override must be keyed owner/name",
};

/** The operator-words refusal for a write error, or `null` if coord named none. */
export function describeWriteRefusal(err: unknown): string | null {
  const text = err instanceof Error ? err.message : String(err ?? "");
  for (const [code, words] of Object.entries(WRITE_REFUSALS)) {
    if (text.includes(code)) return words;
  }
  return null;
}

/**
 * One REPO-band fleet-policy write — the sibling of `useTenantFleetPolicyDial`
 * for a domain that does have a repo in hand when it is decided.
 *
 * `useTenantFleetPolicyDial` deliberately offers no per-repo write (its doc
 * says why: every domain bound to it is decided before a session is scoped to
 * a repo). `github_hosted_ci` is different — a CI run belongs to a repo, so
 * plan `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting` D4/D7
 * gives it repo overrides, keyed `owner/name`, with `inherit` clearing one.
 *
 * The same honesty properties as the tenant dial, per repo:
 *
 * 1. **What is displayed is what coord resolves, never what was written.**
 *    This hook does not hold the displayed value at all; the caller re-reads
 *    its own aggregate (`onConfirmed`) once a write's read-back succeeded.
 * 2. **A failed read-back is UNKNOWN for that repo.** The backend reports
 *    `readback_error` when the write landed but the resolve could not be
 *    read; the repo is recorded in `readbackErrors` and the caller renders it
 *    UNKNOWN until a confirmed read retires it (`clearReadbackErrors`).
 *
 * `master_enabled` is always `true` for the reason the tenant dial gives: a
 * false master resolves `off` whatever the level says, so two spellings of
 * "off" would be indistinguishable on screen.
 *
 * @param domain the fleet-policy domain.
 * @param label  lower-case human name for toasts and the default change note.
 * @param onConfirmed called after a write whose read-back succeeded, so the
 *                    caller can re-read what every repo now resolves (a
 *                    write to one repo cannot change another's, but the
 *                    caller's aggregate is the one source of display).
 */
export function useRepoFleetPolicyWrite<L extends string>(
  domain: string,
  label: string,
  onConfirmed?: () => void
) {
  /** The repo whose write is in flight, so only its control spins. */
  const [savingRepo, setSavingRepo] = useState<string | null>(null);
  const [readbackErrors, setReadbackErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  /** Per repo: why the last write was REFUSED, in operator words. */
  const [writeErrors, setWriteErrors] = useState<
    Readonly<Record<string, string>>
  >({});

  const write = useCallback(
    async (repo: string, level: L, changeNote?: string): Promise<boolean> => {
      try {
        setSavingRepo(repo);
        setWriteErrors((prev) => {
          if (!(repo in prev)) return prev;
          const next = { ...prev };
          delete next[repo];
          return next;
        });
        const result = await putFleetPolicy({
          domain,
          scope_band: "repo",
          scope_key: repo,
          level,
          master_enabled: true,
          change_note:
            changeNote ??
            `Set ${label} for ${repo} to "${level}" from the console`,
        });
        if (result.effective) {
          setReadbackErrors((prev) => {
            if (!(repo in prev)) return prev;
            const next = { ...prev };
            delete next[repo];
            return next;
          });
          toast.success(
            level === "inherit"
              ? `${repo}: override cleared — the tenant setting applies.`
              : `${repo}: wrote "${level}".`
          );
          onConfirmed?.();
        } else {
          // Written, but unconfirmed. Do NOT paint the written level.
          const reason = result.readback_error ?? "read-back returned nothing";
          setReadbackErrors((prev) => ({ ...prev, [repo]: reason }));
          toast.warning(
            `${repo}: the write went through, but the read-back failed — ` +
              "what coord resolves is unknown until this refreshes."
          );
        }
        return true;
      } catch (err) {
        const refusal = describeWriteRefusal(err);
        const text =
          refusal ?? message(err, `Failed to write ${label} for ${repo}`);
        setWriteErrors((prev) => ({ ...prev, [repo]: text }));
        toast.error(`${repo}: ${text}`);
        return false;
      } finally {
        setSavingRepo(null);
      }
    },
    [domain, label, onConfirmed]
  );

  const clearReadbackErrors = useCallback(() => setReadbackErrors({}), []);

  return {
    write,
    savingRepo,
    readbackErrors,
    clearReadbackErrors,
    /** Per repo: the last write's refusal or failure, until the next write. */
    writeErrors,
  };
}
