"use client";

/**
 * Panel 2 — screens and states: the spec pages an app declares and the
 * states and transitions on each, read from the runner's on-disk IR (no
 * running app needed). The reads, the app-id rule and the graph summary are
 * the digital twin's (`useRunnerSpecList` / `useRunnerSpecGraph`,
 * `isValidAppId`, `summarizeSpecGraph`) — reused, not forked — rendered here
 * as a ranked list of screens by how many states each declares.
 *
 * States and transitions come from the GRAPH (the list's projection carries
 * no state machine), so a screen the list names but the graph could not read
 * counts as UNKNOWN, never as zero states.
 *
 * Presentation mode: the app picker is operator-only (it is free text); the
 * audience sees which app is shown, and screen names only for the runner's
 * own app (D3.3). An app id typed before presenting began must not surface
 * through a reason either: it is in the spec reads' paths and in the
 * runner's `app-not-found` answer, so those reasons quote (`relaySource.ts`)
 * and are withheld while presenting, and so is "not a valid app id", which
 * quotes the id itself.
 */

import { useMemo, useState } from "react";
import { Database } from "lucide-react";
import { ShareList, StatCluster } from "@/components/console";
import {
  NAVIGATION_ONLY_PROPS,
  OperatorOnly,
  Provenance,
  RedactedText,
} from "@/components/presentation";
import {
  useRunnerSpecGraph,
  useRunnerSpecList,
} from "@/app/(app)/digital-twin/_hooks/useUiBridge";
import {
  APP_ID_RULE,
  isValidAppId,
  RUNNER_APP_ID,
  summarizeSpecGraph,
} from "@/app/(app)/digital-twin/_lib/ui-bridge-types";
import { appRepoOf } from "../_lib/firstParty";
import { queryView, readStateOf } from "../_lib/readState";
import { RUNNER_ROUTES } from "../_lib/relayReads";
import {
  INVALID_APP_ID_STATUS,
  sameIssue,
  sourceIssueText,
  type BuildReading,
  type SourceIssue,
} from "../_lib/relaySource";
import { DashboardPanel } from "./DashboardPanel";
import { RunnerReadUnknown, SourceUnknown } from "./SourceUnknown";

/** The list and the graph read together, for one UNKNOWN covering both. */
const SPEC_BOTH_ROUTE = {
  ...RUNNER_ROUTES.specGraph,
  subject: "the app's screens, states and transitions",
} as const;

export interface SpecGraphPanelProps {
  deviceId: string | null;
  build: BuildReading;
  /** App ids to suggest: the registries' rows (the field stays free text). */
  appIds: readonly string[];
  /** Why no runner can be asked, when none is targeted. */
  noRunner: string | null;
}

interface ScreenLine {
  readonly id: string;
  readonly states: number | null;
  readonly transitions: number | null;
}

export function SpecGraphPanel({
  deviceId,
  build,
  appIds,
  noRunner,
}: SpecGraphPanelProps) {
  // Default to the runner's own UI: the id runners register for themselves.
  const [appId, setAppId] = useState(RUNNER_APP_ID);
  const valid = isValidAppId(appId);
  const specList = useRunnerSpecList(deviceId, appId);
  const specGraph = useRunnerSpecGraph(deviceId, appId);
  const list = readStateOf(queryView(specList), (d) =>
    Array.isArray(d.specs) ? d : null
  );
  const graph = readStateOf(queryView(specGraph), (d) =>
    Array.isArray(d.pages) ? summarizeSpecGraph(d) : null
  );
  const graphPages = specGraph.data?.pages;
  const listSpecs = list.state === "ok" ? specList.data?.specs : undefined;

  const screens = useMemo<ScreenLine[]>(() => {
    const out = new Map<string, ScreenLine>();
    for (const page of graphPages ?? []) {
      if (!page.id) continue;
      const readable =
        Array.isArray(page.stateIds) && Array.isArray(page.transitionIds);
      out.set(page.id, {
        id: page.id,
        states: readable ? (page.stateIds?.length ?? null) : null,
        transitions: readable ? (page.transitionIds?.length ?? null) : null,
      });
    }
    for (const spec of listSpecs ?? []) {
      if (spec.specId && !out.has(spec.specId)) {
        out.set(spec.specId, {
          id: spec.specId,
          states: null,
          transitions: null,
        });
      }
    }
    return [...out.values()];
  }, [graphPages, listSpecs]);

  const summary = graph.state === "ok" ? graph.value : null;
  const suggestions = useMemo(
    () => [...new Set([RUNNER_APP_ID, ...appIds])].filter(isValidAppId),
    [appIds]
  );
  const repo = appRepoOf(appId);

  // The list and the graph are two reads of one runner; when they fail for
  // the same reason (the runner is not connected), say it once.
  const listIssue: SourceIssue | null =
    list.state === "failed" ? list.issue : null;
  const graphIssue: SourceIssue | null =
    graph.state === "failed" ? graph.issue : null;
  const bothAlike =
    listIssue !== null &&
    graphIssue !== null &&
    sameIssue(listIssue, graphIssue);

  return (
    <DashboardPanel
      captionId="ui-bridge.spec-graph"
      icon={<Database className="h-4 w-4 text-muted-foreground" aria-hidden />}
      summary={
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-spec-summary"
        >
          {summary ? summary.pages : "–"} screens ·{" "}
          {summary ? summary.states : "–"} states
        </span>
      }
      data-testid="coord-ui-bridge-spec"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">App</span>
        <OperatorOnly
          placeholder={
            <span
              className="font-mono"
              data-testid="coord-ui-bridge-spec-app-shown"
            >
              <RedactedText
                text={appId}
                repo={repo}
                descriptor={{ kind: "App" }}
              />
            </span>
          }
        >
          <input
            {...NAVIGATION_ONLY_PROPS}
            value={appId}
            list="coord-ui-bridge-app-ids"
            onChange={(e) => setAppId(e.target.value.trim())}
            aria-label="App whose screens to show"
            aria-invalid={appId !== "" && !valid}
            className="h-7 w-48 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="coord-ui-bridge-spec-app"
          />
          <datalist id="coord-ui-bridge-app-ids">
            {suggestions.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </OperatorOnly>
      </div>

      {noRunner !== null ? (
        <SourceUnknown
          text={sourceIssueText(
            { kind: "no-runner", reason: noRunner },
            RUNNER_ROUTES.specGraph,
            build
          )}
          data-testid="coord-ui-bridge-spec-unknown"
        />
      ) : !valid ? (
        <SourceUnknown
          text={`"${appId}" is not a valid app id, so it was not sent to the runner. App ids are ${APP_ID_RULE}.`}
          withheldStatus={INVALID_APP_ID_STATUS}
          data-testid="coord-ui-bridge-spec-invalid"
        />
      ) : (
        <>
          {bothAlike && graphIssue ? (
            <RunnerReadUnknown
              issue={graphIssue}
              route={SPEC_BOTH_ROUTE}
              build={build}
              data-testid="coord-ui-bridge-spec-unknown"
            />
          ) : (
            <>
              {listIssue && (
                <RunnerReadUnknown
                  issue={listIssue}
                  route={RUNNER_ROUTES.specList}
                  build={build}
                  data-testid="coord-ui-bridge-spec-list-unknown"
                />
              )}
              {graphIssue && (
                <RunnerReadUnknown
                  issue={graphIssue}
                  route={RUNNER_ROUTES.specGraph}
                  build={build}
                  data-testid="coord-ui-bridge-spec-graph-unknown"
                />
              )}
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StatCluster
              data-testid="coord-ui-bridge-spec-counts"
              stats={[
                {
                  key: "screens",
                  label: "screens ",
                  value:
                    summary?.pages ??
                    (list.state === "ok" ? list.value.specs?.length : null),
                },
                { key: "states", label: "states ", value: summary?.states },
                {
                  key: "transitions",
                  label: "transitions ",
                  value: summary?.transitions,
                },
              ]}
            />
            {/* Two reads behind these figures: the states and transitions
                are the graph's, and the screens count is the list's while
                the graph has not answered. */}
            <Provenance
              source="the runner's spec list"
              asOf={list.state === "ok" ? list.asOf : null}
            />
            <Provenance
              source="the runner's spec graph"
              asOf={graph.state === "ok" ? graph.asOf : null}
            />
          </div>
          {summary && summary.unreadablePages > 0 && (
            <p
              className="m-0 text-xs text-muted-foreground"
              data-testid="coord-ui-bridge-spec-unreadable"
            >
              {summary.unreadablePages}{" "}
              {summary.unreadablePages === 1 ? "screen's" : "screens'"} model
              could not be read on the runner, so the totals are a floor, not
              the whole.
            </p>
          )}
          {(list.state === "ok" || graph.state === "ok") && (
            <ShareList
              data-testid="coord-ui-bridge-spec-screens"
              items={screens.map((s) => ({
                key: s.id,
                label: (
                  <RedactedText
                    text={s.id}
                    repo={repo}
                    descriptor={{
                      kind: "Screen",
                      status: s.states === null ? null : `${s.states} states`,
                    }}
                  />
                ),
                count: s.states,
                detail:
                  s.transitions === null
                    ? "transitions unknown"
                    : `${s.transitions} transitions`,
                "data-testid": "coord-ui-bridge-spec-screen",
              }))}
              total={summary?.states ?? null}
              unit="states"
              empty={
                <p
                  className="m-0 text-sm text-muted-foreground"
                  data-testid="coord-ui-bridge-spec-empty"
                >
                  The runner has no screens registered for this app
                  {list.state === "ok" && list.value.reason
                    ? " (it says no pages are registered)"
                    : ""}
                  .
                </p>
              }
            />
          )}
        </>
      )}
    </DashboardPanel>
  );
}
