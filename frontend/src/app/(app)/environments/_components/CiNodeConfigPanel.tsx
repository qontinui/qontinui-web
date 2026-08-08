"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  CI_NODE_DEFAULTS,
  DevenvApiError,
  getCiNodeConfig,
  setCiNodeConfig,
  type CiNodeConfig,
  type CiNodeConfigState,
  type CiNodeReachability,
  type Machine,
} from "@/services/devenv-api";

/**
 * Per-machine editor for the runner's `CiNodeSettings` (plan
 * `2026-08-07-runner-local-ci-parity-and-web-configuration`, Phase 4). Before
 * this, those settings had exactly one editor: a text editor on the runner's
 * own settings.json.
 *
 * ## Why this surface is written defensively
 *
 * `enabled` and `repo_allowlist` are CONSENT surfaces, not preferences.
 * Turning CI on lets a remote system execute commands that a repository
 * declares in its own `.qontinui/ci.toml`, on the owner's hardware, with the
 * owner's files and privileges. The runner's shipped defaults encode that —
 * off, with an empty allowlist, on the stated principle that "allowlisting is
 * a deliberate act" — and this UI must not soften them:
 *
 * * The consequence is stated BEFORE the toggle in DOM order, in the user's
 *   terms, not coord's. A consequence placed after the control is a
 *   justification, not a warning.
 * * There is NO bulk "allow all repos" affordance and no wildcard entry. Repos
 *   are added one at a time and removed one at a time; {@link validateRepoEntry}
 *   rejects `*` with its own message, as does the server.
 * * Nothing here is pre-filled with a friendlier posture than the runner's own
 *   defaults ({@link CI_NODE_DEFAULTS}).
 *
 * ## Why it refuses to claim things
 *
 * qontinui.io cannot read the runner's settings file back, and the runner
 * sends no acknowledgement for settings. So this panel reports three separate
 * facts and never collapses them: what was REQUESTED, whether coord ACCEPTED
 * it for delivery, and whether coord can reach the device at all. A saved
 * config on an offline machine is rendered as saved-and-undelivered — never as
 * applied.
 *
 * The same rule governs FAILURES, via {@link dispatchRefusalCopy}. A refusal is
 * shown as what it was — a value this form can fix, an account that may not
 * send to this machine, or a coordinator that never answered — with the
 * refusing system's own sentence attached. Rendering all of those as one
 * status code would be the same collapse in a different place: it would tell
 * the reader a number and hide whether the problem is theirs to fix.
 */

/** Entry shape the runner's admission check accepts: `owner/name` or a bare name. */
const REPO_ENTRY_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/;

/** Mirrors the server's `CI_NODE_MAX_ALLOWLIST_ENTRIES`. */
export const MAX_ALLOWLIST_ENTRIES = 100;

/**
 * Validate one allowlist entry. Returns an error message, or `null` if valid.
 *
 * A wildcard gets its OWN message rather than the generic format error:
 * "allow everything" is the exact affordance this feature must not have, so
 * someone reaching for it is told why it is absent instead of guessing at a
 * pattern.
 */
export function validateRepoEntry(
  raw: string,
  existing: string[]
): string | null {
  const entry = raw.trim();
  if (!entry) return "Enter a repository first.";
  if (entry.includes("*") || entry === "all") {
    return "There is no wildcard. Every repository this machine may build is listed explicitly, one at a time.";
  }
  if (entry.length > 200) return "That repository name is too long.";
  if (!REPO_ENTRY_RE.test(entry)) {
    return "Use `owner/name` (or just the repository name).";
  }
  if (existing.includes(entry)) return `${entry} is already on the list.`;
  if (existing.length >= MAX_ALLOWLIST_ENTRIES) {
    return `A machine can list at most ${MAX_ALLOWLIST_ENTRIES} repositories.`;
  }
  return null;
}

interface ReachabilityCopy {
  badge: string;
  tone: "success" | "warning" | "secondary" | "destructive";
  message: string;
}

/**
 * Plain-language reachability, one message per state.
 *
 * `unknown` is deliberately its own state rather than being folded into
 * `offline`: "we could not ask" is a statement about qontinui.io, "it is not
 * connected" is a statement about the machine, and only one of them is
 * evidence about the machine.
 */
export function reachabilityCopy(state: CiNodeReachability): ReachabilityCopy {
  switch (state) {
    case "online":
      return {
        badge: "runner connected",
        tone: "success",
        message:
          "This machine's runner is connected, so applying settings sends them straight to it.",
      };
    case "offline":
      return {
        badge: "runner offline",
        tone: "warning",
        message:
          "This machine's runner is not connected right now. Settings you apply are saved here but will not reach it — apply them again once it reconnects.",
      };
    case "unlinked":
      return {
        badge: "no runner paired",
        tone: "secondary",
        message:
          "This machine is not paired with a runner, so there is nothing for these settings to reach. They are saved here and can be applied once you pair one.",
      };
    case "unknown":
    default:
      return {
        badge: "reachability unknown",
        tone: "destructive",
        message:
          "qontinui.io could not check whether this machine is connected. Treat anything you apply now as unconfirmed.",
      };
  }
}

/**
 * A dispatch that did not happen, classified for the reader.
 *
 * `fixableHere` is the field that matters and the reason this type exists at
 * all: the panel must not ask someone to "check the values above" when the
 * refusal was about which account owns the machine, and must not imply
 * helplessness when they typed a `*` they can simply delete.
 */
export interface DispatchRefusal {
  /** What kind of refusal this was, in the user's terms. */
  headline: string;
  /** True when changing something in THIS form would fix it. */
  fixableHere: boolean;
  /** The refusing system's own explanation, when it gave one. */
  detail: string | null;
}

/**
 * Classify a failed dispatch. Returns `null` when nothing was refused.
 *
 * Keyed off coord's HTTP status (and, where it disambiguates nothing else, the
 * reachability verdict) rather than off the prose — prose is what we SHOW, not
 * what we branch on, so re-wording a message upstream can never silently
 * re-class a refusal.
 *
 * `dispatch_status === null` means coord never answered at all: either there
 * was no paired runner to address, or the coordinator was unreachable. Those
 * are reported as themselves, never as a rejection, because "we could not ask"
 * is not evidence that the answer would have been no.
 */
export function dispatchRefusalCopy(
  state: CiNodeConfigState
): DispatchRefusal | null {
  if (state.dispatched !== false) return null;
  const detail = state.dispatch_detail;
  const status = state.dispatch_status;

  if (status === null) {
    if (state.reachability === "unlinked") {
      return {
        headline: "Saved, but there is no runner to send them to yet.",
        fixableHere: false,
        detail,
      };
    }
    return {
      headline: "Saved, but qontinui.io could not reach the coordinator.",
      fixableHere: false,
      detail,
    };
  }
  if (status === 400 || status === 422) {
    return {
      headline: "Saved here, but these settings were not accepted.",
      fixableHere: true,
      detail,
    };
  }
  if (status === 401 || status === 403) {
    return {
      headline:
        "Saved here, but your account is not allowed to send settings to this machine.",
      fixableHere: false,
      detail,
    };
  }
  if (status === 404) {
    // NOT a format error. coord answers 404 both for "no such device" and for
    // "device belongs to another account" on purpose, so this copy must not
    // resolve that either — it says only what is true of both.
    return {
      headline:
        "Saved here, but this machine is not one your account can send settings to.",
      fixableHere: false,
      detail,
    };
  }
  return {
    headline: "Saved here, but the coordinator did not send them.",
    fixableHere: false,
    detail,
  };
}

/** Whether two configs differ (drives the Apply button's enabled state). */
export function configsEqual(a: CiNodeConfig, b: CiNodeConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.max_concurrent_builds === b.max_concurrent_builds &&
    a.min_free_disk_gb === b.min_free_disk_gb &&
    a.repo_allowlist.length === b.repo_allowlist.length &&
    a.repo_allowlist.every((r, i) => r === b.repo_allowlist[i])
  );
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof DevenvApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

interface CiNodeConfigPanelProps {
  machine: Machine;
}

export function CiNodeConfigPanel({ machine }: CiNodeConfigPanelProps) {
  const [state, setState] = useState<CiNodeConfigState | null>(null);
  const [draft, setDraft] = useState<CiNodeConfig>(CI_NODE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCiNodeConfig(machine.id);
      setState(next);
      setDraft(next.requested);
      setLoadError(null);
    } catch (err) {
      // A failed load must not masquerade as "CI is off here" — that reads as
      // a fact about the machine when it is a fact about this request.
      setLoadError(errMessage(err, "Failed to load CI settings"));
    } finally {
      setLoading(false);
    }
  }, [machine.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddRepo = () => {
    const entry = repoInput.trim();
    const problem = validateRepoEntry(entry, draft.repo_allowlist);
    if (problem) {
      setRepoError(problem);
      return;
    }
    setRepoError(null);
    setRepoInput("");
    setDraft((d) => ({ ...d, repo_allowlist: [...d.repo_allowlist, entry] }));
  };

  const handleRemoveRepo = (entry: string) => {
    setRepoError(null);
    setDraft((d) => ({
      ...d,
      repo_allowlist: d.repo_allowlist.filter((r) => r !== entry),
    }));
  };

  const handleApply = async () => {
    setSaving(true);
    try {
      const next = await setCiNodeConfig(machine.id, draft);
      setState(next);
      setDraft(next.requested);
      if (next.dispatched) {
        toast.success(`CI settings sent to ${machine.name}`);
      } else {
        // Saved-but-not-delivered is the honest outcome, not an error the user
        // caused — say what happened rather than "failed". A WARNING and never
        // a success, whatever the reason: the save landed, the delivery did
        // not, and collapsing those two is the lie this panel exists to avoid.
        // The reason rides along as the description so the user does not have
        // to go hunting in the delivery box for it.
        toast.warning(`CI settings saved, but not delivered to ${machine.name}`, {
          description: dispatchRefusalCopy(next)?.detail ?? undefined,
        });
      }
    } catch (err) {
      toast.error(errMessage(err, "Failed to save CI settings"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"
        data-testid="ci-node-loading"
      >
        <Loader2 className="size-4 animate-spin" />
        Loading CI settings…
      </div>
    );
  }

  if (loadError || state === null) {
    return (
      <div className="px-4 py-6 text-center" data-testid="ci-node-load-error">
        <AlertTriangle className="size-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load this machine&apos;s CI settings, so nothing below
          would be true. Nothing has been changed.
        </p>
        <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>
          <RefreshCw className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  const reach = reachabilityCopy(state.reachability);
  const refusal = dispatchRefusalCopy(state);
  const dirty = !configsEqual(draft, state.requested);

  return (
    <div className="space-y-4 px-4 py-4" data-testid="ci-node-panel">
      {/* Reachability first: whether anything here can take effect at all is
          prior to what it would say. */}
      <div
        className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
        data-testid="ci-node-reachability"
        data-reachability={state.reachability}
      >
        <Badge variant={reach.tone}>{reach.badge}</Badge>
        <p className="text-xs text-muted-foreground flex-1 min-w-[16rem]">
          {reach.message}
        </p>
      </div>

      {/* THE CONSENT STATEMENT. Rendered before the toggle, deliberately: a
          consequence placed after the control is a justification, not a
          warning. */}
      <div className="space-y-1" data-testid="ci-node-consent">
        <p className="text-sm font-medium">What turning this on lets happen</p>
        <p className="text-sm text-muted-foreground">
          Build jobs sent from qontinui.io will run on{" "}
          <span className="font-medium">{machine.name}</span> itself. Each job
          runs the commands the target repository declares in its own{" "}
          <code className="font-mono text-xs">.qontinui/ci.toml</code> — on your
          hardware, against your files, with your account&apos;s permissions.
          qontinui.io never supplies those commands; the repository does.
        </p>
        <p className="text-sm text-muted-foreground">
          Only the repositories you list below can run here. The list starts
          empty, and an empty list means nothing runs even while CI is on.
        </p>
      </div>

      <label
        className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
        htmlFor={`ci-node-enabled-${machine.id}`}
      >
        <Switch
          id={`ci-node-enabled-${machine.id}`}
          data-testid="ci-node-enabled"
          checked={draft.enabled}
          onCheckedChange={(checked) =>
            setDraft((d) => ({ ...d, enabled: checked }))
          }
        />
        <span className="text-sm">
          Accept CI build jobs on this machine
          {!draft.enabled && (
            <span className="text-muted-foreground"> — currently off</span>
          )}
        </span>
      </label>

      {/* Allowlist. One entry in, one entry out — there is no bulk control
          here and adding one would defeat the point of the list. */}
      <div className="space-y-2" data-testid="ci-node-allowlist">
        <div>
          <p className="text-sm font-medium">
            Repositories allowed to build here
          </p>
          <p className="text-xs text-muted-foreground">
            Added one at a time, on purpose. A repository not on this list is
            refused even when CI is on.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            placeholder="owner/name"
            aria-label="Repository to allow"
            data-testid="ci-node-repo-input"
            value={repoInput}
            onChange={(e) => {
              setRepoInput(e.target.value);
              setRepoError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddRepo();
              }
            }}
            className="bg-background border-border max-w-xs font-mono text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="ci-node-repo-add"
            onClick={handleAddRepo}
          >
            <Plus className="size-4" />
            Allow this repository
          </Button>
        </div>
        {repoError && (
          <p
            className="text-xs text-destructive"
            data-testid="ci-node-repo-error"
          >
            {repoError}
          </p>
        )}
        {draft.repo_allowlist.length === 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="ci-node-allowlist-empty"
          >
            No repositories allowed yet — nothing can build on this machine.
          </p>
        ) : (
          <ul
            className="flex flex-wrap gap-2"
            data-testid="ci-node-allowlist-items"
          >
            {draft.repo_allowlist.map((entry) => (
              <li key={entry}>
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-xs">
                  {entry}
                  <button
                    type="button"
                    aria-label={`Remove ${entry}`}
                    data-testid={`ci-node-repo-remove-${entry}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => handleRemoveRepo(entry)}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="space-y-1" htmlFor={`ci-node-builds-${machine.id}`}>
          <span className="block text-sm font-medium">Concurrent builds</span>
          <Input
            id={`ci-node-builds-${machine.id}`}
            type="number"
            min={1}
            max={64}
            data-testid="ci-node-max-builds"
            value={draft.max_concurrent_builds}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                max_concurrent_builds: Number(e.target.value),
              }))
            }
            className="bg-background border-border w-28 text-sm"
          />
        </label>
        <label className="space-y-1" htmlFor={`ci-node-disk-${machine.id}`}>
          <span className="block text-sm font-medium">
            Free disk required (GiB)
          </span>
          <Input
            id={`ci-node-disk-${machine.id}`}
            type="number"
            min={1}
            data-testid="ci-node-min-disk"
            value={draft.min_free_disk_gb}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                min_free_disk_gb: Number(e.target.value),
              }))
            }
            className="bg-background border-border w-28 text-sm"
          />
          <span className="block text-xs text-muted-foreground">
            A build below this is refused rather than filling the disk.
          </span>
        </label>
      </div>

      {/* The delivery record. Deliberately worded as "requested"/"sent", never
          "active": there is no read-back and no ack, so a stronger word here
          would be a claim this surface cannot support. */}
      <div
        className="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        data-testid="ci-node-delivery"
      >
        <p>
          qontinui.io cannot read this machine&apos;s runner settings back.
          Everything above is what you have{" "}
          <span className="font-medium">requested</span>, not a reading of what
          the runner is running.
        </p>
        {state.configured ? (
          <p>
            {state.dispatched_at
              ? `Last sent to the machine ${new Date(state.dispatched_at).toLocaleString()}. The runner does not acknowledge settings, so "sent" is as far as this goes.`
              : "Saved here, but never successfully sent to the machine."}
          </p>
        ) : (
          <p data-testid="ci-node-never-configured">
            Never configured from qontinui.io. The runner is using whatever is
            in its own settings file.
          </p>
        )}
        {/* The refusal, in the refusing system's own words. A bare status code
            here would tell the reader a number and hide the one thing they
            need: whether this is theirs to fix. */}
        {refusal && (
          <div
            className="space-y-1 text-destructive"
            data-testid="ci-node-dispatch-refusal"
            data-dispatch-status={state.dispatch_status ?? ""}
            data-dispatch-error={state.dispatch_error ?? ""}
            data-fixable-here={refusal.fixableHere ? "true" : "false"}
          >
            <p className="font-medium">{refusal.headline}</p>
            {refusal.detail && (
              <p data-testid="ci-node-dispatch-detail">{refusal.detail}</p>
            )}
            {refusal.fixableHere && (
              <p data-testid="ci-node-dispatch-fixable">
                Adjust the values above and apply again.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="brand-primary"
          size="sm"
          disabled={saving || !dirty}
          data-testid="ci-node-apply"
          onClick={handleApply}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save and send to machine
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="ci-node-discard"
            onClick={() => {
              setDraft(state.requested);
              setRepoInput("");
              setRepoError(null);
            }}
          >
            Discard changes
          </Button>
        )}
        {dirty && (
          <span className="text-xs text-muted-foreground">
            Unsaved — nothing has been sent to the machine yet.
          </span>
        )}
      </div>
    </div>
  );
}
