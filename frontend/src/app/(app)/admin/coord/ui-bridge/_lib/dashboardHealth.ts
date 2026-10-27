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
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import {
  appTotalMeaning,
  appTotalValue,
  type AppTotal,
} from "./appRegistryStatus";
import type { EffectCounts } from "./componentEffectStatus";
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

export function deriveDashboardHealth(
  input: DashboardHealthInput
): DashboardHealth {
  const counts = value(input.components);
  const badges: HealthBadge[] = [
    {
      key: "components",
      label: `components ${counts?.components ?? "–"}`,
      title: "Components the runner's interface registers",
      "data-testid": "coord-ui-bridge-health-components",
    },
    {
      key: "actions",
      label: `actions ${counts?.actions ?? "–"}`,
      title: "Actions across those components",
      "data-testid": "coord-ui-bridge-health-actions",
    },
    {
      key: "undeclared",
      label: `undeclared ${counts?.undeclared ?? "–"}`,
      tone: counts === null || counts.undeclared > 0 ? "waiting" : "default",
      title:
        "Actions whose author declared no effect — counted as undeclared, never as reads",
      "data-testid": "coord-ui-bridge-health-undeclared",
    },
    {
      key: "apps",
      label: `apps ${appTotalValue(input.apps) ?? "–"}`,
      title: appTotalMeaning(input.apps),
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
  if (input.health.state === "failed") {
    // Say what the failed read leaves unknown, and nothing more: the other
    // runner reads are their own answers, and the badges beside this
    // sentence show the ones that came back.
    const components =
      input.components.state === "failed"
        ? ` Its component actions are UNKNOWN too — ${issuePhrase(
            input.components.issue,
            input.componentsRoute
          )}.`
        : "";
    return {
      level: "amber",
      headline: `${input.machine}'s health did not answer, so its build and SDK features are UNKNOWN.${components}`,
      badges,
    };
  }

  const pageHealth = value(input.pageHealth);
  const occlusion = value(input.occlusion);
  if (pageHealth === "critical") {
    return {
      level: "red",
      headline: `Page health reports ${input.machine}'s current page as broken.`,
      badges,
    };
  }
  if (occlusion === "hides-text") {
    return {
      level: "red",
      headline: `Text on ${input.machine}'s screen is hidden behind an overlay.`,
      badges,
    };
  }

  if (input.components.state === "failed") {
    return {
      level: "amber",
      headline: `${input.machine}'s component actions are UNKNOWN — ${issuePhrase(
        input.components.issue,
        input.componentsRoute
      )}.`,
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
  if (counts.undeclared > 0) {
    return {
      level: "amber",
      headline: `${input.machine}: ${counts.undeclared} of ${counts.actions} actions declare no effect.`,
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
