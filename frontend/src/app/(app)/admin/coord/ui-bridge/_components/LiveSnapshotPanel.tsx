"use client";

/**
 * Panel 3 — the live element snapshot: what is on the runner's own window
 * right now, as structured elements (`GET /ui-bridge/control/snapshot`, the
 * digital twin's `useRunnerSnapshot`, reused). Captured ON DEMAND only — it
 * drives the runner's webview — and the capture button is navigation-only:
 * pressing it changes what this page displays and nothing on the runner, so it
 * stays live in presentation mode.
 *
 * What the panel shows everyone is STRUCTURE: the element and component
 * counts and the element types. A native window capture (the SDK was not
 * connected) carries no element tree, so its counts are UNKNOWN, never zero
 * (`snapshotHasElementTree`). The snapshot's own text — every element's label
 * and content, which can name a session or a client — appears only in the
 * operator's raw view.
 */

import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareList, StatCluster } from "@/components/console";
import {
  NAVIGATION_ONLY_PROPS,
  Provenance,
  RedactedText,
  usePresentationMode,
} from "@/components/presentation";
import { useRunnerSnapshot } from "@/app/(app)/digital-twin/_hooks/useUiBridge";
import {
  snapshotHasElementTree,
  type UiBridgeSnapshot,
} from "@/app/(app)/digital-twin/_lib/ui-bridge-types";
import { appRepoOf } from "../_lib/firstParty";
import { NOT_ASKED, queryView, readStateOf } from "../_lib/readState";
import { RUNNER_ROUTES } from "../_lib/relayReads";
import { sourceIssueText, type BuildReading } from "../_lib/relaySource";
import { elementTypeCounts } from "../_lib/snapshotReading";
import { useOnDemandRequest } from "../_lib/useOnDemandRequest";
import { DashboardPanel } from "./DashboardPanel";
import {
  RunnerReadUnknown,
  SourceUnknown,
  StaleReadNote,
} from "./SourceUnknown";

export interface LiveSnapshotPanelProps {
  deviceId: string | null;
  build: BuildReading;
  noRunner: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function LiveSnapshotPanel({
  deviceId,
  build,
  noRunner,
}: LiveSnapshotPanelProps) {
  const { presenting } = usePresentationMode();
  // Asked for THIS runner only; a switch away ends the request, so coming
  // back neither re-captures nor shows the earlier capture as this one's.
  const { requested, request } = useOnDemandRequest(deviceId);
  const snapshot = useRunnerSnapshot(deviceId, requested);
  const read = readStateOf<UiBridgeSnapshot, UiBridgeSnapshot>(
    requested ? queryView(snapshot) : NOT_ASKED,
    (d) => (isRecord(d) ? d : null)
  );
  const snap = read.state === "ok" ? read.value : null;
  const tree = snap !== null && snapshotHasElementTree(snap);
  const elements = tree && Array.isArray(snap.elements) ? snap.elements : null;
  const components =
    tree && Array.isArray(snap.components) ? snap.components : null;
  const types = elements ? elementTypeCounts(elements) : null;
  const where =
    snap?.page?.title ?? snap?.page?.pathname ?? snap?.route ?? null;

  const capture = () => {
    if (deviceId === null) return;
    if (!requested) {
      request();
      return;
    }
    return snapshot.refetch();
  };

  return (
    <DashboardPanel
      captionId="ui-bridge.snapshot"
      icon={<Camera className="h-4 w-4 text-muted-foreground" aria-hidden />}
      summary={
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-snapshot-summary"
        >
          {elements ? elements.length : "–"} elements
        </span>
      }
      headerActions={
        <Button
          {...NAVIGATION_ONLY_PROPS}
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={deviceId === null || snapshot.isFetching}
          onClick={capture}
          title="Capture the runner's window now. Reads only: nothing on the runner changes."
          data-testid="coord-ui-bridge-snapshot-capture"
        >
          {snapshot.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Camera className="h-3.5 w-3.5" aria-hidden />
          )}
          {snap ? "Capture again" : "Capture snapshot"}
        </Button>
      }
      data-testid="coord-ui-bridge-snapshot"
    >
      {noRunner !== null ? (
        <SourceUnknown
          text={sourceIssueText(
            { kind: "no-runner", reason: noRunner },
            RUNNER_ROUTES.snapshot,
            build
          )}
          data-testid="coord-ui-bridge-snapshot-unknown"
        />
      ) : read.state === "idle" ? (
        <p
          className="m-0 text-sm text-muted-foreground"
          data-testid="coord-ui-bridge-snapshot-idle"
        >
          Not captured yet — a snapshot is taken only when asked, because it
          reads the runner&apos;s live window.
        </p>
      ) : read.state === "loading" ? (
        <p className="m-0 text-sm text-muted-foreground">Capturing…</p>
      ) : read.state === "failed" ? (
        <RunnerReadUnknown
          issue={read.issue}
          route={RUNNER_ROUTES.snapshot}
          build={build}
          data-testid="coord-ui-bridge-snapshot-unknown"
        />
      ) : (
        <>
          {read.stale && (
            <StaleReadNote
              asOf={read.asOf}
              data-testid="coord-ui-bridge-snapshot-stale"
            />
          )}
          <p
            className="m-0 text-xs text-muted-foreground"
            data-testid="coord-ui-bridge-snapshot-subject"
          >
            Captured{" "}
            {snap?.appId ? (
              <RedactedText
                text={snap.appId}
                repo={appRepoOf(snap.appId)}
                descriptor={{ kind: "App" }}
              />
            ) : (
              "an app the snapshot does not name"
            )}
            {where && (
              <>
                {" — "}
                <RedactedText
                  text={where}
                  repo={appRepoOf(snap?.appId)}
                  descriptor={{ kind: "Screen" }}
                />
              </>
            )}
          </p>
          {!tree && (
            <SourceUnknown
              text={`The runner fell back to a window capture with no element tree, so its element counts are unknown.${
                typeof snap?.note === "string" && snap.note && !presenting
                  ? ` It said: ${snap.note}`
                  : ""
              }`}
              data-testid="coord-ui-bridge-snapshot-no-tree"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StatCluster
              data-testid="coord-ui-bridge-snapshot-counts"
              stats={[
                {
                  key: "elements",
                  label: "elements ",
                  value: elements?.length,
                },
                {
                  key: "components",
                  label: "components ",
                  value: components?.length,
                },
                { key: "types", label: "element types ", value: types?.length },
              ]}
            />
            <Provenance source="the runner's live snapshot" asOf={read.asOf} />
          </div>
          {types && (
            <ShareList
              data-testid="coord-ui-bridge-snapshot-types"
              items={types.map((t) => ({
                key: t.type,
                label: t.type,
                count: t.count,
              }))}
              total={elements?.length ?? null}
              unit="elements"
              empty={
                <p className="m-0 text-sm text-muted-foreground">
                  The snapshot holds no elements.
                </p>
              }
            />
          )}
          {!presenting && (
            <details
              className="text-xs"
              data-testid="coord-ui-bridge-snapshot-raw"
            >
              <summary className="cursor-pointer text-muted-foreground">
                Raw snapshot
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed">
                {JSON.stringify(snap, null, 2)}
              </pre>
            </details>
          )}
        </>
      )}
    </DashboardPanel>
  );
}
