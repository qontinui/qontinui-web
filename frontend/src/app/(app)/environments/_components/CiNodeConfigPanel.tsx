"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  /**
   * True when nothing was refused and delivery is only DEFERRED: the
   * coordinator stored the settings and the machine applies them on its next
   * connect. Rendered without the destructive tone.
   */
  deferred?: boolean;
  /**
   * True when the coordinator ACCEPTED the save (a 2xx) but did not send it:
   * nothing was refused, so it is rendered without the destructive tone, and
   * Apply stays off for an unchanged re-send while this verdict is shown. A
   * reload loses the verdict (a GET carries no `dispatch_error`), after which
   * the panel can only say the saved settings were not sent since.
   */
  notRefused?: boolean;
  /**
   * True for the one accepted-but-not-sent reason the coordinator names: a
   * newer change for the same machine is held and will be used instead.
   */
  superseded?: boolean;
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
  if (state.dispatch_error === STORED_FOR_NEXT_CONNECT) {
    // Coord stored the directive but could not publish it now: deferred, not
    // refused. Whether the machine picks it up by itself depends on its runner
    // version, which the detail says; the headline claims only what happened.
    return {
      headline:
        "Not sent yet: the coordinator saved these settings but could not send them.",
      fixableHere: false,
      detail,
      deferred: true,
    };
  }
  if (state.dispatch_error === SUPERSEDED_BY_NEWER) {
    // Coord answered 2xx but published nothing for THIS save: it already
    // holds a newer change for the same machine (stored, not necessarily sent
    // yet) and the machine converges on that. Not a refusal, and not a
    // delivery to re-send: re-sending this one would undo the newer change.
    return {
      headline:
        "Not sent: the coordinator holds a newer settings change for this machine and will use that instead.",
      fixableHere: false,
      detail,
      notRefused: true,
      superseded: true,
    };
  }
  if (state.dispatch_error === NOT_DISPATCHED) {
    // Coord answered 2xx with `dispatched: false` and no reason this app
    // recognises: accepted, not refused, and not sent.
    return {
      headline:
        "Not sent: the coordinator accepted these settings but did not send them.",
      fixableHere: false,
      detail,
      notRefused: true,
    };
  }
  const relayHeadline = isConsentRelayCode(state.dispatch_error)
    ? (consentRelayHeadline(
        state.consent_relay_errors?.length
          ? state.consent_relay_errors
          : [state.dispatch_error]
      ) ?? consentRelayHeadline([state.dispatch_error]))
    : undefined;
  if (relayHeadline !== undefined) {
    // Coord answered 2xx and published the other settings, but a consent or
    // grant choice is not confirmed: the coordinator predates that field (the
    // choice never left it), its answer carried another value, or its answer
    // did not say what it sent (unknown — not a refusal, and not evidence of
    // an older coordinator). `dispatch_error` names the first such choice;
    // `consent_relay_errors` names every one, so the headline can too, and a
    // second is never lost behind the first. A backend predating that field
    // sends only the code, which still gets its own headline.
    return { headline: relayHeadline, fixableHere: false, detail };
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

/** The backend's `dispatch_error` when coord stored the settings but could not
 *  send them now: the machine applies them on its next connect. */
export const STORED_FOR_NEXT_CONNECT = "stored_for_next_connect";
/** The backend's `dispatch_error` when coord answered 2xx but sent nothing:
 *  it already holds a newer change for the same machine and uses that. */
export const SUPERSEDED_BY_NEWER = "superseded_by_newer";
/** The backend's `dispatch_error` when coord answered 2xx with
 *  `dispatched: false` and no reason the backend recognises. */
export const NOT_DISPATCHED = "coord_not_dispatched";
/** The backend's `dispatch_error` when coord did not echo `model_access` back. */
export const MODEL_ACCESS_NOT_RELAYED = "coord_predates_model_access";
/** The backend's `dispatch_error` when coord's answer could not confirm it. */
export const MODEL_ACCESS_UNCONFIRMED = "model_access_unconfirmed";
/** The backend's `dispatch_error` when coord echoed `model_access` back with
 *  a different value than the save sent. */
export const MODEL_ACCESS_ECHO_MISMATCH = "model_access_echo_mismatch";
/** The same three outcomes for the toolchain-convergence grant. */
export const CANONICAL_CONVERGE_NOT_RELAYED =
  "coord_predates_canonical_converge";
export const CANONICAL_CONVERGE_UNCONFIRMED = "canonical_converge_unconfirmed";
export const CANONICAL_CONVERGE_ECHO_MISMATCH =
  "canonical_converge_echo_mismatch";

type ConsentRelayKind = "not_relayed" | "unconfirmed" | "echo_mismatch";

interface ConsentRelayCode {
  /** The choice it is about, article included, for a combined headline. */
  noun: string;
  kind: ConsentRelayKind;
  /** The headline when this is the only consent-relay problem. */
  headline: string;
  /**
   * What this outcome did on a runner that reads a missing grant as a revoke
   * (one predating the keep-an-unstated-grant fix), for a combined headline.
   * Absent when a missing key leaves the runner's value alone.
   */
  olderRunnerNote?: string;
}

const GRANT_DROPPED_NOTE =
  "On an older runner the settings that did arrive turned toolchain convergence off.";
const GRANT_MAYBE_DROPPED_NOTE =
  "If the grant was dropped, an older runner turned toolchain convergence off.";

/**
 * The consent-relay codes — a 2xx whose echo does not confirm a consent or
 * grant choice the save made — and how each is told. One table, so a code
 * that {@link dispatchRefusalCopy} names is exactly a code that
 * {@link canResendUnchanged} lets the owner re-send.
 *
 * The grant's not-carried and unconfirmed headlines say what happened on the
 * machine, not only what did not: the directive that DID arrive carried no
 * grant, and a runner predating the keep-an-unstated-grant fix reads a
 * missing grant as a revoke.
 */
const CONSENT_RELAY_CODES: ReadonlyMap<string, ConsentRelayCode> = new Map([
  [
    MODEL_ACCESS_NOT_RELAYED,
    {
      noun: "the model-access choice",
      kind: "not_relayed",
      headline:
        "Sent, but the coordinator does not carry the model-access choice yet, so that choice did not reach the machine.",
    },
  ],
  [
    MODEL_ACCESS_UNCONFIRMED,
    {
      noun: "the model-access choice",
      kind: "unconfirmed",
      headline:
        "Sent, but the coordinator's answer did not confirm the model-access choice, so whether it reached the machine is unknown.",
    },
  ],
  [
    MODEL_ACCESS_ECHO_MISMATCH,
    {
      noun: "the model-access choice",
      kind: "echo_mismatch",
      headline:
        "Sent, but the coordinator answered with a different model-access choice than this save sent, so the machine may hold a choice you did not make.",
    },
  ],
  [
    CANONICAL_CONVERGE_NOT_RELAYED,
    {
      noun: "the toolchain-convergence grant",
      kind: "not_relayed",
      headline:
        "Sent, but the coordinator does not carry the toolchain-convergence grant yet, so that choice did not reach the machine — and on an older runner the settings that did arrive turned toolchain convergence off.",
      olderRunnerNote: GRANT_DROPPED_NOTE,
    },
  ],
  [
    CANONICAL_CONVERGE_UNCONFIRMED,
    {
      noun: "the toolchain-convergence grant",
      kind: "unconfirmed",
      headline:
        "Sent, but the coordinator's answer did not confirm the toolchain-convergence grant, so whether it reached the machine is unknown — and if it did not, an older runner turned toolchain convergence off.",
      olderRunnerNote: GRANT_MAYBE_DROPPED_NOTE,
    },
  ],
  [
    CANONICAL_CONVERGE_ECHO_MISMATCH,
    {
      noun: "the toolchain-convergence grant",
      kind: "echo_mismatch",
      headline:
        "Sent, but the coordinator answered with a different toolchain-convergence grant than this save sent, so the machine may hold a choice you did not make.",
    },
  ],
]);

/** Whether `code` is one of the consent-relay codes in {@link CONSENT_RELAY_CODES}. */
function isConsentRelayCode(code: string | null): code is string {
  return code !== null && CONSENT_RELAY_CODES.has(code);
}

/**
 * The headline for one answer's consent-relay codes (`consent_relay_errors`,
 * in field order). One code gets its own headline; several get one that
 * names every choice, so the headline never names only the first of two
 * choices that both failed to arrive. Unknown codes are ignored; `undefined`
 * when none is known.
 */
export function consentRelayHeadline(codes: string[]): string | undefined {
  const known = codes
    .map((code) => CONSENT_RELAY_CODES.get(code))
    .filter((entry): entry is ConsentRelayCode => entry !== undefined);
  const [first] = known;
  if (first === undefined) return undefined;
  if (known.length === 1) return first.headline;
  const nouns = known.map((entry) => entry.noun).join(" and ");
  const kinds = new Set(known.map((entry) => entry.kind));
  let lead: string;
  if (kinds.size === 1 && kinds.has("not_relayed")) {
    lead = `Sent, but the coordinator does not carry ${nouns} yet, so those choices did not reach the machine.`;
  } else if (kinds.size === 1 && kinds.has("unconfirmed")) {
    lead = `Sent, but the coordinator's answer did not confirm ${nouns}, so whether those choices reached the machine is unknown.`;
  } else {
    lead = `Sent, but ${nouns} did not reach the machine as chosen.`;
  }
  const notes = known.flatMap((entry) =>
    entry.olderRunnerNote ? [entry.olderRunnerNote] : []
  );
  return [lead, ...notes].join(" ");
}

/**
 * True when the saved settings have not been sent since they were last saved:
 * saved here (`requested_at`) after the last accepted send (`dispatched_at`),
 * or never sent. Read from persisted fields, so it survives a reload — a GET
 * carries no `dispatched` verdict.
 */
export function savedButUnsent(state: CiNodeConfigState): boolean {
  if (!state.configured || !state.requested_at) return false;
  if (!state.dispatched_at) return true;
  return Date.parse(state.requested_at) > Date.parse(state.dispatched_at);
}

/**
 * Whether Apply may re-send the saved settings unchanged. Yes when the panel's
 * own copy tells the owner to apply again: a deferred delivery, the
 * consent-relay outcomes (model access and the toolchain-convergence grant,
 * not carried or not confirmed), a transport failure (coord never answered, so
 * `dispatch_status` is null and the copy says to try again shortly), or — read
 * (`dispatched === null`, after a reload) — settings saved but not sent since.
 * Also for a save coord accepted but did not send for no named reason
 * (`coord_not_dispatched`): no newer change is known that a re-send could
 * undo. Never right after a superseded save, which a re-send would undo.
 * Never for a machine with no runner, and never right after a refusal coord
 * answered (an unchanged re-send would be refused again).
 */
export function canResendUnchanged(state: CiNodeConfigState): boolean {
  if (state.reachability === "unlinked") return false;
  if (dispatchRefusalCopy(state)?.deferred) return true;
  // Accepted but not sent for no named reason: no newer change is known to
  // exist, so an unchanged re-send is not known to undo one.
  if (state.dispatch_error === NOT_DISPATCHED) return true;
  if (isConsentRelayCode(state.dispatch_error)) return true;
  if (state.dispatched === false && state.dispatch_status === null) return true;
  return state.dispatched === null && savedButUnsent(state);
}

/** Mirrors the server's `max_concurrent_builds` bounds (`ge=1, le=64`). */
export const MAX_CONCURRENT_BUILDS_MIN = 1;
export const MAX_CONCURRENT_BUILDS_MAX = 64;

/**
 * Commit a typed concurrency draft to a value.
 *
 * An empty or non-numeric draft keeps `previous` — it never becomes `0`, `1`
 * or `null`. Typing a number and then clearing the box is not an instruction,
 * and returning to "use the host's suggestion" is: that is the explicit
 * control's job alone, so clearing can never silently write either a number
 * or `null`. A number outside the server's band is clamped into it rather
 * than saved into a refusal. Same shape as the runner's own panel.
 */
export function parseConcurrencyInput(
  raw: string,
  previous: number | null
): number | null {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return previous;
  return Math.min(
    MAX_CONCURRENT_BUILDS_MAX,
    Math.max(MAX_CONCURRENT_BUILDS_MIN, n)
  );
}

/** Whether two configs differ (drives the Apply button's enabled state). */
export function configsEqual(a: CiNodeConfig, b: CiNodeConfig): boolean {
  return (
    a.enabled === b.enabled &&
    // `null` ("use the host's suggestion") equals only `null`; strict
    // equality already says so, and a stored config predating the nullable
    // field (so `undefined`) is normalised to `null` rather than read as a
    // change nobody made.
    (a.max_concurrent_builds ?? null) === (b.max_concurrent_builds ?? null) &&
    a.min_free_disk_gb === b.min_free_disk_gb &&
    // Same normalisation: a stored config predating `model_access` or
    // `canonical_converge` reads as "not set here", not as a change — and a
    // grant-only change still enables Apply.
    (a.model_access ?? null) === (b.model_access ?? null) &&
    (a.canonical_converge ?? null) === (b.canonical_converge ?? null) &&
    a.repo_allowlist.length === b.repo_allowlist.length &&
    a.repo_allowlist.every((r, i) => r === b.repo_allowlist[i])
  );
}

/**
 * A consent or grant control's three choices. `machine` is `null` on the
 * wire: qontinui.io sends nothing for it, and a runner that keeps an unstated
 * value keeps what it holds.
 */
export type ConsentChoice = "machine" | "on" | "off";

export function consentChoice(value: boolean | null): ConsentChoice {
  if (value === true) return "on";
  if (value === false) return "off";
  return "machine";
}

const CONSENT_CHOICE_VALUE: Record<ConsentChoice, boolean | null> = {
  machine: null,
  on: true,
  off: false,
};

const CONSENT_CHOICES: readonly ConsentChoice[] = ["machine", "on", "off"];

const MODEL_ACCESS_CHOICE_LABEL: Record<ConsentChoice, string> = {
  machine: "Leave as set on the machine",
  on: "On",
  off: "Off",
};

const CANONICAL_CONVERGE_CHOICE_LABEL: Record<ConsentChoice, string> = {
  machine: "Leave as set on the machine",
  on: "Grant",
  off: "Revoke",
};

/**
 * Said under an explicit choice of either consent or grant (On/Off, Grant/
 * Revoke). The choice is stored with the settings, so it rides along with
 * EVERY later save from this panel — an unrelated edit re-sends it and
 * overrides whatever was set on the machine since. "Leave as set on the
 * machine" is the only way to stop that, so the copy says so where the
 * choice is made.
 */
const CONSENT_RESENT_NOTE =
  "Every save from this panel sends this choice again, overriding a change made on the machine since; choose Leave as set on the machine to stop sending it.";

/**
 * What the current choice means. `null` is NEVER drawn as "on": qontinui.io
 * sends nothing for it, and the runner keeps the last value it received —
 * which may be an explicit value an earlier save sent from here, or one the
 * owner set on the machine itself. Only a runner that never received one is
 * on by default.
 */
export function modelAccessStateText(value: boolean | null): string {
  if (value === true)
    return `On: qontinui.io tells the machine to allow it. ${CONSENT_RESENT_NOTE}`;
  if (value === false)
    return `Off: qontinui.io tells the machine to refuse it. ${CONSENT_RESENT_NOTE}`;
  return "Left as set on the machine: qontinui.io sends nothing for this, so the runner keeps the last value it received, from here or set on the machine (on, if it never received one).";
}

/**
 * What the current grant choice means. `null` is NEVER drawn as granted or as
 * revoked: qontinui.io cannot read this machine's grant back, sends nothing
 * for it, and the runner keeps whatever it holds — so the copy says the page
 * does not know, rather than guessing either way. "Keeps" is the runner half
 * of the plan (Phase 1); a runner predating it reads a missing grant as a
 * revoke, and the copy says that too, because an explicit Grant is the one
 * choice that keeps the grant on such a machine — but only once the
 * coordinator carries the grant (plan Phase 2). A coordinator predating it
 * drops the Grant, the older runner revokes anyway, and the save says so
 * (`coord_predates_canonical_converge`), so the copy does not promise more.
 */
export function canonicalConvergeStateText(value: boolean | null): string {
  if (value === true)
    return `Grant: qontinui.io tells the machine a dispatch may converge its toolchains. ${CONSENT_RESENT_NOTE}`;
  if (value === false)
    return `Revoke: qontinui.io tells the machine not to, so such dispatches are refused. ${CONSENT_RESENT_NOTE}`;
  return "Left as set on the machine: qontinui.io cannot see whether this machine holds the grant right now, and sends nothing for it, so the runner keeps whatever it holds — from an earlier save here or set on the machine (off, if it was never set). An older runner cannot keep a grant nothing was sent for and turns it off on any settings change; choose Grant to keep it on there once the coordinator carries the grant — until then, a save with Grant reports that the grant did not reach the machine.";
}

interface ConsentChoiceFieldProps {
  /** The control's name: its heading and its button group's label. */
  label: string;
  /** What the choice does on this machine, stated BEFORE the control. */
  body: ReactNode;
  /** What the choice does not stop or limit, also before the control. */
  residual: ReactNode;
  /** Button text for each of the three choices. */
  choiceLabels: Record<ConsentChoice, string>;
  /** The sentence under the control saying what the current choice means. */
  stateText: (value: boolean | null) => string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
  /**
   * `data-testid` prefix: the field is `<prefix>`, its residual
   * `<prefix>-residual`, each choice `<prefix>-<choice>` and the state line
   * `<prefix>-state` (carrying `data-state`).
   */
  testIdPrefix: string;
}

/**
 * A consent or grant this surface may set on the machine, as three choices
 * rather than a switch. A two-state switch has to draw "not set here" as one
 * of on/off, and once toggled it cannot return to "not set", so an unrelated
 * save would then send an explicit value — and could re-enable, or revoke,
 * something the owner set on the machine itself. The consequence, including
 * what the choice does NOT stop, is stated before the control, as for
 * `enabled`.
 */
function ConsentChoiceField({
  label,
  body,
  residual,
  choiceLabels,
  stateText,
  value,
  onChange,
  testIdPrefix,
}: ConsentChoiceFieldProps) {
  const current = consentChoice(value);
  return (
    <div className="space-y-2" data-testid={testIdPrefix}>
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
        <p
          className="text-sm text-muted-foreground"
          data-testid={`${testIdPrefix}-residual`}
        >
          {residual}
        </p>
      </div>
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={label}
      >
        {CONSENT_CHOICES.map((choice) => (
          <Button
            key={choice}
            type="button"
            size="sm"
            variant={current === choice ? "default" : "outline"}
            aria-pressed={current === choice}
            data-testid={`${testIdPrefix}-${choice}`}
            onClick={() => onChange(CONSENT_CHOICE_VALUE[choice])}
          >
            {choiceLabels[choice]}
          </Button>
        ))}
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-testid={`${testIdPrefix}-state`}
        data-state={current}
      >
        {stateText(value)}
      </p>
    </div>
  );
}

/**
 * "Let CI steps use this machine's Claude accounts" — the DEVICE scope of the
 * CI model-access off-switches (plan
 * `2026-10-13-ci-node-runs-model-dependent-eval-steps` D6; the tenant and repo
 * scopes live on Dev Ops ▸ CI). The consequence — including what off does NOT
 * stop (D11) — is stated before the control.
 */
function ModelAccessField({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (next: boolean | null) => void;
}) {
  return (
    <ConsentChoiceField
      label="Let CI steps use this machine's Claude accounts"
      body={
        <>
          A repository can mark CI steps that call a model (its{" "}
          <code className="font-mono text-xs">.qontinui/ci.toml</code> declares{" "}
          <code className="font-mono text-xs">[model]</code>). On this machine
          those calls run through the runner on your own Claude accounts, within
          the budget the repository declares; the step itself is never given a
          login. The runner allows it unless it is turned off. Turned off, those
          steps still run, without model access, and their results read UNKNOWN.
        </>
      }
      residual={
        <>
          What off does not stop: CI steps run as your user, so a step that
          deliberately points <code className="font-mono text-xs">claude</code>{" "}
          at this machine&apos;s account files can still use them. Only allow
          repositories you trust.
        </>
      }
      choiceLabels={MODEL_ACCESS_CHOICE_LABEL}
      stateText={modelAccessStateText}
      value={value}
      onChange={onChange}
      testIdPrefix="ci-node-model-access"
    />
  );
}

/**
 * "Let CI dispatches converge this machine's toolchains" — the device's
 * canonical-convergence GRANT (plan
 * `2026-11-28-a-coord-relayed-ci-node-directive-revokes-the-canonical-convergence-grant`
 * Phase 3). Before it, a remote settings change could not carry the grant at
 * all, and every one revoked it as a side effect. "Leave as set" is the
 * default and sends nothing, because this page cannot see the machine's
 * current grant.
 */
function CanonicalConvergeField({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (next: boolean | null) => void;
}) {
  return (
    <ConsentChoiceField
      label="Let CI dispatches converge this machine's toolchains"
      body={
        <>
          A repository can require that its builds run at the canonical
          toolchain versions (its{" "}
          <code className="font-mono text-xs">.qontinui/ci.toml</code> declares{" "}
          <code className="font-mono text-xs">[canonical]</code>). With the
          grant, a dispatch from such a repository may install or switch this
          machine&apos;s global toolchains — rustup, volta, pyenv — toward the
          canonical versions before it builds. Without it, such a dispatch is
          refused with the drift named, and the toolchains are left alone. The
          runner ships with the grant off.
        </>
      }
      residual={
        <>
          What the grant does not limit: it is one grant for this machine, not
          one per repository — any repository on the list above that declares{" "}
          <code className="font-mono text-xs">[canonical]</code> may use it —
          and the toolchains it changes are the ones everything else on this
          machine uses too, not a copy kept for CI.
        </>
      }
      choiceLabels={CANONICAL_CONVERGE_CHOICE_LABEL}
      stateText={canonicalConvergeStateText}
      value={value}
      onChange={onChange}
      testIdPrefix="ci-node-canonical-converge"
    />
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
  // The concurrency box's raw text while it is being edited, or `null` when it
  // is showing the committed value. Committed on blur AND on Save (see
  // `effectiveDraft`), so a synthetic click that never moves focus still saves
  // what is on screen.
  const [buildsDraft, setBuildsDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCiNodeConfig(machine.id);
      setState(next);
      setDraft(next.requested);
      setBuildsDraft(null);
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

  // The draft with any pending concurrency text committed. Save sends THIS,
  // not `draft`: relying on the input's blur alone would let a typed value
  // show on the page while the old one saved.
  const effectiveDraft: CiNodeConfig =
    buildsDraft === null
      ? draft
      : {
          ...draft,
          max_concurrent_builds: parseConcurrencyInput(
            buildsDraft,
            draft.max_concurrent_builds
          ),
        };

  const handleApply = async () => {
    setSaving(true);
    try {
      const next = await setCiNodeConfig(machine.id, effectiveDraft);
      setState(next);
      setDraft(next.requested);
      setBuildsDraft(null);
      if (next.dispatched) {
        toast.success(`CI settings sent to ${machine.name}`);
      } else {
        // Saved-but-not-delivered is the honest outcome, not an error the user
        // caused — say what happened rather than "failed". A WARNING and never
        // a success, whatever the reason: the save landed, the delivery did
        // not, and collapsing those two is the lie this panel exists to avoid.
        // The reason rides along as the description so the user does not have
        // to go hunting in the delivery box for it.
        toast.warning(
          `CI settings saved, but not delivered to ${machine.name}`,
          {
            description: dispatchRefusalCopy(next)?.detail ?? undefined,
          }
        );
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
  const dirty = !configsEqual(effectiveDraft, state.requested);
  const usingSuggestion = effectiveDraft.max_concurrent_builds === null;

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
        <div className="space-y-1" data-testid="ci-node-max-builds-field">
          <label
            className="block text-sm font-medium"
            htmlFor={`ci-node-builds-${machine.id}`}
          >
            Concurrent builds
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`ci-node-builds-${machine.id}`}
              type="number"
              min={MAX_CONCURRENT_BUILDS_MIN}
              max={MAX_CONCURRENT_BUILDS_MAX}
              step={1}
              data-testid="ci-node-max-builds"
              // Empty while following the host's suggestion: the runner
              // computes that number and qontinui.io does not know it.
              value={buildsDraft ?? draft.max_concurrent_builds ?? ""}
              placeholder="Suggested"
              onChange={(e) => setBuildsDraft(e.target.value)}
              onBlur={() => {
                if (buildsDraft === null) return;
                const typed = buildsDraft;
                setBuildsDraft(null);
                setDraft((d) => ({
                  ...d,
                  max_concurrent_builds: parseConcurrencyInput(
                    typed,
                    d.max_concurrent_builds
                  ),
                }));
              }}
              className="bg-background border-border w-28 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="ci-node-max-builds-use-suggested"
              disabled={usingSuggestion}
              onClick={() => {
                setBuildsDraft(null);
                setDraft((d) => ({ ...d, max_concurrent_builds: null }));
              }}
            >
              Use suggested
            </Button>
          </div>
          <span
            className="block text-xs text-muted-foreground max-w-xs"
            data-testid="ci-node-max-builds-mode"
            data-mode={usingSuggestion ? "suggested" : "explicit"}
          >
            {usingSuggestion
              ? "Using the host's suggested capacity — the runner derives it from this machine's cores and memory."
              : `Set explicitly to ${effectiveDraft.max_concurrent_builds}. "Use suggested" hands the choice back to the runner.`}
          </span>
        </div>
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

      <ModelAccessField
        value={draft.model_access ?? null}
        onChange={(next) => setDraft((d) => ({ ...d, model_access: next }))}
      />

      <CanonicalConvergeField
        value={draft.canonical_converge ?? null}
        onChange={(next) =>
          setDraft((d) => ({ ...d, canonical_converge: next }))
        }
      />

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
              ? `Last sent to the machine ${new Date(state.dispatched_at).toLocaleString()}. The runner does not acknowledge settings, so "sent" is as far as this goes.${savedButUnsent(state) ? " Saved again since then, and not sent from qontinui.io since." : ""}`
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
            className={
              refusal.deferred || refusal.notRefused
                ? "space-y-1 text-muted-foreground"
                : "space-y-1 text-destructive"
            }
            data-testid="ci-node-dispatch-refusal"
            data-deferred={refusal.deferred ? "true" : "false"}
            data-superseded={refusal.superseded ? "true" : "false"}
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
          disabled={saving || (!dirty && !canResendUnchanged(state))}
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
              setBuildsDraft(null);
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
