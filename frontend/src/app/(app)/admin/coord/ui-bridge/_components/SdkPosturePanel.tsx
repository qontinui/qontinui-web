"use client";

/**
 * Panel 4 — capabilities and trust: the runner's build, the UI Bridge SDK
 * features it ships (`/health` `sdkFeatures`) and its relay registration
 * binding (`/health` `data.uiBridgeBinding`: the configured and active modes
 * and each rule's would-refuse / refused counters), read by
 * `runnerHealth.ts`.
 *
 * Every figure is the runner's own measurement, so the panel shows it with
 * its source and age rather than asserting a posture. A build that serves no
 * feature inventory or no binding block is UNKNOWN for that half — never
 * "no features" or "binding off".
 */

import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatCluster } from "@/components/console";
import { Provenance } from "@/components/presentation";
import type { ReadState } from "../_lib/readState";
import { RUNNER_ROUTES } from "../_lib/relayReads";
import { sourceIssueText, type BuildReading } from "../_lib/relaySource";
import {
  bindingModeLabel,
  totalOf,
  type RunnerPosture,
} from "../_lib/runnerHealth";
import { DashboardPanel } from "./DashboardPanel";
import {
  RunnerReadUnknown,
  SourceUnknown,
  StaleReadNote,
} from "./SourceUnknown";

export interface SdkPosturePanelProps {
  health: ReadState<RunnerPosture>;
  build: BuildReading;
  noRunner: string | null;
}

export function SdkPosturePanel({
  health,
  build,
  noRunner,
}: SdkPosturePanelProps) {
  const posture = health.state === "ok" ? health.value : null;
  const asOf = health.state === "ok" ? health.asOf : null;
  const features = posture?.sdkFeatures ?? null;
  const binding = posture?.binding ?? null;

  return (
    <DashboardPanel
      captionId="ui-bridge.sdk-posture"
      icon={
        <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
      }
      summary={
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-sdk-summary"
        >
          {features ? features.length : "–"} SDK features · binding{" "}
          {binding ? bindingModeLabel(binding.activeMode ?? binding.mode) : "–"}
        </span>
      }
      data-testid="coord-ui-bridge-sdk"
    >
      {noRunner !== null ? (
        <SourceUnknown
          text={sourceIssueText(
            { kind: "no-runner", reason: noRunner },
            RUNNER_ROUTES.health,
            build
          )}
          data-testid="coord-ui-bridge-sdk-unknown"
        />
      ) : health.state === "failed" ? (
        <RunnerReadUnknown
          issue={health.issue}
          route={RUNNER_ROUTES.health}
          build={build}
          data-testid="coord-ui-bridge-sdk-unknown"
        />
      ) : health.state !== "ok" || posture === null ? (
        <p className="m-0 text-sm text-muted-foreground">Reading the runner…</p>
      ) : (
        <>
          {health.stale && (
            <StaleReadNote
              asOf={asOf}
              data-testid="coord-ui-bridge-sdk-stale"
            />
          )}
          <p
            className="m-0 text-xs text-muted-foreground"
            data-testid="coord-ui-bridge-sdk-build"
          >
            Runner build{" "}
            <span className="font-mono text-foreground/90">
              {posture.buildId ?? "–"}
            </span>
            {posture.gitSha && (
              <>
                {" "}
                from commit{" "}
                <span className="font-mono text-foreground/90">
                  {posture.gitSha}
                </span>
              </>
            )}
            {posture.unstamped === true &&
              " — built without a stamped frontend bundle"}
            .
          </p>

          <section
            className="space-y-2"
            data-testid="coord-ui-bridge-sdk-features"
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatCluster
                stats={[
                  {
                    key: "features",
                    label: "SDK features ",
                    value: features?.length,
                  },
                ]}
              />
              <Provenance source="the runner's health" asOf={asOf} />
            </div>
            {features === null ? (
              <SourceUnknown
                text="This runner build serves no SDK feature inventory, so which UI Bridge capabilities it ships is unknown — not none."
                data-testid="coord-ui-bridge-sdk-features-unknown"
              />
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {features.map((f) => (
                  <li key={f}>
                    <Badge
                      variant="outline"
                      className="font-mono text-[11px] font-normal text-muted-foreground"
                    >
                      {f}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="space-y-2"
            data-testid="coord-ui-bridge-sdk-binding"
          >
            {binding === null ? (
              <SourceUnknown
                text="This runner build reports no relay registration binding, so how it checks who may register an app is unknown."
                data-testid="coord-ui-bridge-sdk-binding-unknown"
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatCluster
                    data-testid="coord-ui-bridge-sdk-binding-counts"
                    stats={[
                      {
                        key: "mode",
                        label: "binding ",
                        value: bindingModeLabel(binding.mode),
                        tone: binding.mode === null ? "warning" : "default",
                        title:
                          "The binding mode this runner is configured with",
                      },
                      {
                        key: "active",
                        label: "applied ",
                        value: bindingModeLabel(binding.activeMode),
                        tone:
                          binding.activeMode === null ? "warning" : "default",
                        title: "The binding mode this runner is applying now",
                      },
                      {
                        key: "rules",
                        label: "rules ",
                        value: binding.rules.length,
                      },
                      {
                        key: "would",
                        label: "would refuse ",
                        value: totalOf(binding.rules, "wouldRefuse"),
                        title:
                          "Registrations a rule would have refused while it is only counting",
                      },
                      {
                        key: "refused",
                        label: "refused ",
                        value: totalOf(binding.rules, "refused"),
                        title: "Registrations a rule refused",
                      },
                      {
                        key: "full",
                        label: "registry-full refusals ",
                        value: binding.registryFullRefusals,
                        title:
                          "Registrations refused because the app registry was full — a capacity event, not a rule",
                      },
                    ]}
                  />
                  <Provenance source="the runner's health" asOf={asOf} />
                </div>
                {binding.rules.length > 0 && (
                  <ul
                    className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                    data-testid="coord-ui-bridge-sdk-rules"
                  >
                    {binding.rules.map((r) => (
                      <li key={r.rule}>
                        <Badge
                          variant="outline"
                          className="font-mono text-[11px] font-normal tabular-nums"
                          title={`${r.rule}: would refuse ${r.wouldRefuse ?? "–"}, refused ${r.refused ?? "–"}`}
                        >
                          {r.rule} {r.wouldRefuse ?? "–"}/{r.refused ?? "–"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}
    </DashboardPanel>
  );
}
