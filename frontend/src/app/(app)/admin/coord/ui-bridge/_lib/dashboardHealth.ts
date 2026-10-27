/**
 * The UI Bridge dashboard's opening verdict — the one health strip the page
 * starts with (style guide R1), derived from the reads already on the page and
 * never from a second fetch.
 *
 * The question it answers is the page's own: *can an agent see and safely
 * operate this runner's interface?* That rests on three things, in order:
 *
 * 1. the runner answering at all (its `/health`);
 * 2. its component actions being readable, and every one DECLARING its effect
 *    — an undeclared action is a control an automated walk cannot classify,
 *    so any undeclared action keeps the strip amber (R3's ignorance floor);
 * 3. once page health has been run, the page not being reported broken, and
 *    no identifying text being covered — the two results that are red.
 *
 * Green therefore means something measured: the runner answered, it
 * registers at least one action and every one declares its effect, and
 * nothing that was checked came back red or UNKNOWN. A read that did not
 * answer never contributes a green — including an occlusion row that is
 * UNKNOWN, which it is on every runner today (no relay carries the sweep), so
 * a strip that has had page health run on it is never green.
 *
 * Nor does a STALE read — one whose latest refresh failed, so the page keeps
 * an earlier read's value (`readState.ts`). Its figures stay on the badges,
 * kept and labelled, but the verdict is about NOW and the earlier read is not
 * now (style guide R6: a retained verdict may not look re-confirmed, in either
 * direction). So a stale read holds the level at amber and the headline says
 * which figures are from an earlier read — over a green that read would have
 * given, and over a red: a page an earlier read found broken is reported as
 * that, at that read, not as broken now.
 *
 * Red is decided first, by CURRENT reads alone: a page page health has just
 * found broken, or text the sweep has just found hidden, is red whatever else
 * did not answer — a `/health` that failed says nothing about either. And
 * every headline names the stale reads behind the badges, the red ones and
 * the amber ones that report a failed read included, not only the headline
 * whose subject they are.
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import {
  appTotalMeaning,
  appTotalValue,
  type AppTotal,
} from "./appRegistryStatus";
import {
  effectCountValue,
  unreadableEntriesText,
  type EffectCounts,
} from "./componentEffectStatus";
import type { OcclusionKind } from "./occlusionStatus";
import type { PageHealthKind } from "./pageHealthStatus";
import type { ReadState } from "./readState";
import type { SourceIssue } from "./relaySource";
import type { RunnerRoute } from "./relayReads";

export interface DashboardHealthInput {
  /** How the page names the runner (its alias in presentation mode). */
  readonly machine: string;
  /** Why no runner is read, or null when one is. */
  readonly noRunner: string | null;
  /** Whether the runner's `/health` answered. */
  readonly health: ReadState<unknown>;
  readonly components: ReadState<EffectCounts>;
  /** The page-health summary, once run. */
  readonly pageHealth: ReadState<PageHealthKind>;
  /**
   * The occlusion row, once page health is run — the standing UNKNOWN while
   * no relay carries the sweep (`occlusionReadOf`).
   */
  readonly occlusion: ReadState<OcclusionKind>;
  /** Apps across both registries — exact, a floor, or unknown. */
  readonly apps: AppTotal;
  /**
   * Whether a registry behind `apps` is an earlier read's value (its latest
   * refresh failed). The total is kept and its badge says so.
   */
  readonly appsStale: boolean;
  /** The SDK feature count, or null when not served. */
  readonly sdkFeatures: number | null;
  readonly componentsRoute: RunnerRoute;
}

export interface DashboardHealth {
  readonly level: HealthStripLevel;
  readonly headline: string;
  readonly badges: HealthBadge[];
}

/** A short phrase for why a read has no answer, for the strip's headline. */
export function issuePhrase(issue: SourceIssue, route: RunnerRoute): string {
  switch (issue.kind) {
    case "no-runner":
      return issue.reason;
    case "withheld":
      return "the runner withheld it under this project's egress setting";
    case "failed":
      return "the read failed";
    case "not-carried":
      return route.carriage === "dashboard"
        ? "this runner's build predates the relay entries this page reads"
        : "the relay does not carry it";
  }
}

const value = <T>(read: ReadState<T>): T | null =>
  read.state === "ok" ? read.value : null;

/** A read's value only when it is CURRENT: answered, and not kept from earlier. */
const current = <T>(read: ReadState<T>): T | null =>
  read.state === "ok" && !read.stale ? read.value : null;

const isStale = (read: ReadState<unknown>): boolean =>
  read.state === "ok" && read.stale;

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function deriveDashboardHealth(
  input: DashboardHealthInput
): DashboardHealth {
  const counts = value(input.components);
  // Registry entries no count includes make every count a floor: `≥N`, the
  // spelling the app total uses, with the reason in the badge's title. The
  // component panel's header takes the same rule (`effectCountValue`).
  const unreadable = counts?.unreadable ?? 0;
  const count = (n: number | undefined): string | number =>
    n === undefined ? "–" : effectCountValue(n, unreadable);
  const floorNote =
    unreadable > 0 ? ` — at least: ${unreadableEntriesText(unreadable)}` : "";
  const badges: HealthBadge[] = [
    {
      key: "components",
      label: `components ${count(counts?.components)}`,
      title: `Components the runner's interface registers${floorNote}`,
      "data-testid": "coord-ui-bridge-health-components",
    },
    {
      key: "actions",
      label: `actions ${count(counts?.actions)}`,
      title: `Actions across those components${floorNote}`,
      "data-testid": "coord-ui-bridge-health-actions",
    },
    {
      key: "undeclared",
      label: `undeclared actions ${count(counts?.undeclared)}`,
      tone:
        counts === null || counts.undeclared > 0 || unreadable > 0
          ? "waiting"
          : "default",
      title: `Actions whose author declared no effect — counted as undeclared, never as reads${floorNote}`,
      "data-testid": "coord-ui-bridge-health-undeclared",
    },
    {
      key: "apps",
      label: `apps ${appTotalValue(input.apps) ?? "–"}`,
      title: `${appTotalMeaning(input.apps)}${
        input.appsStale
          ? " — from an earlier read: the last refresh of an app registry failed"
          : ""
      }`,
      "data-testid": "coord-ui-bridge-health-apps",
    },
    {
      key: "sdk",
      label: `SDK features ${input.sdkFeatures ?? "–"}`,
      title: "UI Bridge SDK features this runner build ships",
      "data-testid": "coord-ui-bridge-health-sdk",
    },
  ];

  if (input.noRunner !== null) {
    return {
      level: "amber",
      headline: `No runner to read — ${input.noRunner}. Every runner panel is UNKNOWN.`,
      badges,
    };
  }

  // The reads whose figures are an earlier read's: their latest refresh
  // failed. Every headline below names them, so a kept value is never
  // presented as re-confirmed (R6).
  const stale = [
    isStale(input.health) ? "health" : null,
    isStale(input.components) ? "component actions" : null,
    isStale(input.pageHealth) ? "page health" : null,
    isStale(input.occlusion) ? "occlusion check" : null,
  ].filter((name): name is string => name !== null);
  const earlier =
    value(input.pageHealth) === "critical" && isStale(input.pageHealth)
      ? " That earlier read reported its page as broken."
      : value(input.occlusion) === "hides-text" && isStale(input.occlusion)
        ? " That earlier read found text on its screen hidden behind an overlay."
        : "";
  const staleClause = `the last refresh of its ${listed(stale)} failed, so what this page shows of ${
    stale.length === 1 ? "it" : "them"
  } is from an earlier read.${earlier}`;
  /** The stale reads, as a sentence after a headline about something else. */
  const staleNote =
    stale.length > 0
      ? ` ${staleClause.charAt(0).toUpperCase()}${staleClause.slice(1)}`
      : "";

  // Red is a statement about NOW, so only a current read may make it — and a
  // current one makes it whatever else did not answer: a failed `/health`
  // says nothing about a page page health has just found broken.
  const pageHealth = current(input.pageHealth);
  const occlusion = current(input.occlusion);
  if (pageHealth === "critical") {
    return {
      level: "red",
      headline: `Page health reports ${input.machine}'s current page as broken.${staleNote}`,
      badges,
    };
  }
  if (occlusion === "hides-text") {
    return {
      level: "red",
      headline: `Text on ${input.machine}'s screen is hidden behind an overlay.${staleNote}`,
      badges,
    };
  }

  if (input.health.state === "failed") {
    // Say what the failed read leaves unknown, and nothing more: the other
    // runner reads are their own answers, and the badges beside this
    // sentence show the ones that came back — said to be an earlier read's
    // where they are.
    const components =
      input.components.state === "failed"
        ? ` Its component actions are UNKNOWN too — ${issuePhrase(
            input.components.issue,
            input.componentsRoute
          )}.`
        : "";
    return {
      level: "amber",
      headline: `${input.machine}'s health did not answer, so its build and SDK features are UNKNOWN.${components}${staleNote}`,
      badges,
    };
  }
  if (input.components.state === "failed") {
    return {
      level: "amber",
      headline: `${input.machine}'s component actions are UNKNOWN — ${issuePhrase(
        input.components.issue,
        input.componentsRoute
      )}.${staleNote}`,
      badges,
    };
  }
  if (stale.length > 0) {
    return {
      level: "amber",
      headline: `${input.machine}: ${staleClause}`,
      badges,
    };
  }
  if (counts === null || input.health.state !== "ok") {
    return {
      level: "amber",
      headline: `Reading ${input.machine}…`,
      badges,
    };
  }
  const unreadableEntries = `${unreadable} ${
    unreadable === 1 ? "entry" : "entries"
  } in its component registry could not be read`;
  if (counts.undeclared > 0) {
    return {
      level: "amber",
      headline: `${input.machine}: ${counts.undeclared} of ${counts.actions} actions declare no effect.${
        unreadable > 0 ? ` ${unreadableEntries}, so both counts are floors.` : ""
      }`,
      badges,
    };
  }
  if (unreadable > 0) {
    // Every action read declares its effect, but the ones in the entries
    // that could not be read are unknown — so "every action" is not measured.
    return {
      level: "amber",
      headline: `${input.machine}: ${unreadableEntries}, so whether every action declares its effect is UNKNOWN.`,
      badges,
    };
  }
  if (counts.actions === 0) {
    // A measured zero, but not a pass: "every action declares its effect" is
    // vacuous over no actions, and an interface with nothing registered gives
    // an agent nothing it can classify.
    return {
      level: "amber",
      headline: `${input.machine} registers no component actions on its current screen, so there is nothing an agent can classify.`,
      badges,
    };
  }
  // Page health and the sweep are only ever asked for on purpose; once they
  // were, a check that came back without an answer keeps the strip amber —
  // an unknown is never folded into a green.
  const unansweredChecks = [
    input.pageHealth.state === "failed" ||
    (input.pageHealth.state === "ok" && pageHealth === "unknown")
      ? "page health"
      : null,
    input.occlusion.state === "failed" ||
    (input.occlusion.state === "ok" && occlusion === "unknown")
      ? "occlusion"
      : null,
  ].filter((c): c is string => c !== null);
  if (unansweredChecks.length > 0) {
    return {
      level: "amber",
      headline: `${input.machine}: every one of its ${counts.actions} actions declares its effect, but its ${unansweredChecks.join(" and ")} ${unansweredChecks.length === 1 ? "is" : "are"} UNKNOWN.`,
      badges,
    };
  }
  return {
    level: "green",
    headline: `${input.machine}: every one of its ${counts.actions} actions declares its effect.`,
    badges,
  };
}
