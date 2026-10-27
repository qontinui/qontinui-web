"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  Database,
  Loader2,
  Network,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { OperatorOnly } from "@/components/presentation";
import { targetRunnerId, useRunnerTarget } from "@/lib/runner";
import {
  useRunnerApps,
  useRunnerSnapshot,
  useRunnerSpecGraph,
  useRunnerSpecList,
} from "../_hooks/useUiBridge";
import { RelayFailure } from "./RelayFailure";
import { sharesRelayCause } from "../_lib/relay-error-presentation";
import {
  APP_ID_RULE,
  isValidAppId,
  registeredAppSuggestions,
  RUNNER_APP_ID,
  snapshotHasElementTree,
  type AppIdSuggestion,
  summarizeSpecGraph,
  type UiBridgeSnapshot,
} from "../_lib/ui-bridge-types";

/**
 * Suggestions for the App field — a datalist, not an allowlist: any id the
 * runner has registered works, and an id it has not registered answers
 * `404 app-not-found`. The panel suggests the runner's REGISTERED ids, read
 * from its `GET /apps` (see `useRunnerApps`). These static ids are the
 * fallback while that read is loading or when it fails — a published runner
 * whose relay allowlist predates `GET /apps` answers 403. A runner registers
 * ids through its dev bootstrap or `POST /apps`, besides its own UI (see
 * `RUNNER_APP_ID`). The dev bootstrap (QONTINUI_DEV_BOOTSTRAP=1,
 * `bootstrap_dev_apps`) registers `qontinui-web` and `qontinui-supervisor`,
 * each only when its `<workspace>/<dir>/frontend` directory exists.
 */
const APP_ID_SUGGESTIONS: ReadonlyArray<AppIdSuggestion> = [
  { id: RUNNER_APP_ID, note: "The runner's own UI" },
  { id: "qontinui-web", note: "Dev bootstrap only (QONTINUI_DEV_BOOTSTRAP=1)" },
  {
    id: "qontinui-supervisor",
    note: "Dev bootstrap only (QONTINUI_DEV_BOOTSTRAP=1)",
  },
];

/** A count, or "—" while the read that would establish it has not answered. */
function Counter({
  value,
  label,
}: {
  value: number | undefined;
  label: string;
}) {
  return (
    <span data-testid={`ui-bridge-count-${label.replace(/\s+/g, "-")}`}>
      <span className="text-lg font-semibold">{value ?? "—"}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** An array's length, or undefined when the payload does not carry the key. */
function lengthOf(v: unknown): number | undefined {
  return Array.isArray(v) ? v.length : undefined;
}

/**
 * What the snapshot says it captured: its own `appId` and page. Shown so the
 * card never implies it captured the app named in the App field — the runner
 * snapshots its own window whatever that field says.
 */
function SnapshotSubject({ snap }: { snap: UiBridgeSnapshot }) {
  const page = snap.page;
  const where = page?.url ?? page?.pathname ?? snap.route;
  return (
    <p className="mb-2 text-xs" data-testid="ui-bridge-snapshot-subject">
      <span className="text-muted-foreground">Captured: </span>
      {snap.appId ? (
        <code>{snap.appId}</code>
      ) : (
        <span className="text-muted-foreground">
          an app the snapshot does not name
        </span>
      )}
      {page?.title && <span> — {page.title}</span>}
      {where && (
        <>
          {" "}
          <span className="text-muted-foreground">at</span>{" "}
          <code className="break-all">{where}</code>
        </>
      )}
    </p>
  );
}

/** What presentation mode shows in the inspector's place. */
function UiBridgePresented() {
  return (
    <div
      data-testid="ui-bridge-presented"
      className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
    >
      Operators inspect the interface models behind the UI Bridge app twin here.
      The app names, page ids and live window captures it shows are not shown in
      presentation mode; the Twin map carries the app twin&apos;s summary.
    </div>
  );
}

/*
 * The inspector's three controls register their UI Bridge ids (stable, for
 * automation and spec-checks) where they render, and only while they do: they
 * render only once a runner is connected. A registration with no element on
 * screen is one the SDK goes looking for: `useUIElement` polls the DOM for
 * it, 3 tries 100 ms apart (`pollForTaggedElement`), and unmounting does not
 * stop the poll (`SubspaceDetailActions.tsx` says the same of the drawer's
 * buttons). So registered in the inspector, above its no-runner return, all
 * three ids started a poll on every mount with no runner.
 */

/** The App field, its suggestions and its Refresh button. */
function AppIdControls({
  appId,
  onAppId,
  appIdValid,
  appIdInvalid,
  suggestions,
  onRefresh,
}: {
  appId: string;
  onAppId: (appId: string) => void;
  appIdValid: boolean;
  appIdInvalid: boolean;
  suggestions: ReadonlyArray<AppIdSuggestion>;
  onRefresh: () => void;
}) {
  const { ref: appIdRef } = useUIElement({
    id: "ui-bridge-app-id",
    label: "UI Bridge app id to inspect",
    type: "input",
  });
  const { ref: refreshRef } = useUIElement({
    id: "ui-bridge-refresh",
    label: "Refresh UI Bridge spec list/graph",
    type: "button",
  });
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground" htmlFor="dt-app-id">
        App
      </label>
      <input
        ref={appIdRef}
        id="dt-app-id"
        value={appId}
        list="dt-app-id-options"
        onChange={(e) => onAppId(e.target.value.trim())}
        aria-invalid={appIdInvalid}
        aria-describedby={appIdInvalid ? "dt-app-id-invalid" : undefined}
        className={`h-7 w-48 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${appIdInvalid ? "border-amber-500" : "border-input"}`}
      />
      <datalist id="dt-app-id-options">
        {suggestions.map(({ id, note }) => (
          <option key={id} value={id} label={note} />
        ))}
      </datalist>
      <Button
        ref={refreshRef}
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={!appIdValid}
        onClick={onRefresh}
      >
        <RefreshCw className="size-3.5" /> Refresh
      </Button>
    </div>
  );
}

/** The button that captures a live snapshot of the runner's own window. */
function CaptureSnapshotButton({
  fetching,
  onCapture,
}: {
  fetching: boolean;
  onCapture: () => void;
}) {
  const { ref } = useUIElement({
    id: "ui-bridge-capture-snapshot",
    label: "Capture a live UI Bridge snapshot of the runner's own window",
    type: "button",
  });
  return (
    <Button
      ref={ref}
      size="sm"
      className="mb-3 gap-1.5"
      disabled={fetching}
      onClick={onCapture}
    >
      {fetching ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Network className="size-4" />
      )}
      Capture snapshot
    </Button>
  );
}

/**
 * UI Bridge tab, inside the presentation lens's boundary (plan
 * `2026-10-23-console-presentation-spaces` D3): the inspector reads app names
 * and page ids a runner registered — free text the lens cannot prove
 * first-party — and captures the runner's own window, which can show
 * anything on the operator's screen. So the whole inspector is
 * `OperatorOnly`; the Twin map's app-twin card is the presentable summary.
 */
export function UiBridgePanel() {
  return (
    <OperatorOnly placeholder={<UiBridgePresented />}>
      <UiBridgeInspector />
    </OperatorOnly>
  );
}

/**
 * The inspector — the twin's UI half, split into its two natures:
 *  - CACHED / processed: the runner's spec pages + state-machine graph for
 *    the App field's id, read from on-disk IR (no running app needed).
 *  - AUTOMATION-required: a live snapshot of the runner's OWN window,
 *    captured on demand. It does not follow the App field.
 */
function UiBridgeInspector() {
  // The runner this tree targets (explicit choice, else coord's pick), read
  // from the target so a device the web list has not caught up with counts.
  const deviceId = targetRunnerId(useRunnerTarget());
  // Default to the runner's own UI: the id runners register for themselves.
  const [appId, setAppId] = useState(RUNNER_APP_ID);
  // Free text, checked here rather than sent: an id the registry would never
  // admit cannot answer (see `isValidAppId`).
  const appIdValid = isValidAppId(appId);
  const appIdInvalid = appId !== "" && !appIdValid;
  const [snapshotRequested, setSnapshotRequested] = useState(false);

  // The runner's registered apps, when it can say; the static suggestions
  // otherwise (loading, a 403 from a runner whose relay allowlist predates
  // `GET /apps`, or any other failure). No banner for that: the field is free
  // text either way, and the suggestions are only a convenience.
  const registeredApps = useRunnerApps(deviceId);
  // A failed REFETCH keeps the last good `data` beside `isError`; the list is
  // only trusted while the latest read succeeded.
  const registeredData = registeredApps.isError
    ? undefined
    : registeredApps.data;
  const appSuggestions = useMemo(
    () => registeredAppSuggestions(registeredData) ?? APP_ID_SUGGESTIONS,
    [registeredData]
  );

  const specList = useRunnerSpecList(deviceId, appId);
  const specGraph = useRunnerSpecGraph(deviceId, appId);
  const snapshot = useRunnerSnapshot(deviceId, snapshotRequested);

  // useMemo so the array reference is stable across renders (the `?? []`
  // otherwise makes a new array every render).
  const specs = useMemo(() => specList.data?.specs ?? [], [specList.data]);
  // States and transitions come from the GRAPH: the spec list's per-page
  // `config` is a projection with no state machine, so counting states from
  // it read 0 for every app. `null` until the graph has answered.
  const graph = useMemo(
    () => (specGraph.data ? summarizeSpecGraph(specGraph.data) : null),
    [specGraph.data]
  );
  const snap = snapshot.data;
  // A native window capture has no element tree, so its `elements: []` is
  // "unknown" (its note says so), not zero: its counters show "—".
  const snapTree = !!snap && snapshotHasElementTree(snap);

  // The list and the graph are two queries against the same relay to the same
  // device, so the dominant failure — the runner is not connected — fails both
  // identically. Show one box in that case rather than the same three lines
  // twice; they stay separate whenever the diagnoses actually differ.
  const bothFailedAlike =
    specList.isError &&
    specGraph.isError &&
    sharesRelayCause(specList.error, specGraph.error);

  if (!deviceId) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOff className="size-4" /> Connect a runner to inspect its UI
          Bridge spec pages and capture live snapshots.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AppIdControls
        appId={appId}
        onAppId={setAppId}
        appIdValid={appIdValid}
        appIdInvalid={appIdInvalid}
        suggestions={appSuggestions}
        onRefresh={() => {
          specList.refetch();
          specGraph.refetch();
        }}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* CACHED / processed side */}
        <section className="rounded-lg border border-l-4 border-l-emerald-500 bg-card p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Database className="size-4" /> Processed (cached)
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Spec pages + state-machine graph for the app above, read from the
            runner&apos;s on-disk IR — no running app required.
          </p>

          {appId === "" && (
            <p className="text-sm text-muted-foreground">
              Enter an app id to read its spec pages.
            </p>
          )}
          {appIdInvalid && (
            <p
              id="dt-app-id-invalid"
              data-testid="ui-bridge-app-id-invalid"
              className="text-sm text-amber-700 dark:text-amber-500"
            >
              <code className="break-all">{appId}</code> is not a valid app id,
              so it was not sent to the runner. App ids are {APP_ID_RULE}.
            </p>
          )}
          {specList.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading specs…
            </p>
          )}
          {/*
            The graph is a SECOND, independent query. Its failure used to be
            rendered nowhere at all: `graphPages` fell back to `[]` and the
            counter below simply showed "0 graph nodes", which is what a
            genuinely empty graph looks like. A failed read and an empty result
            are different facts and must not share a rendering.
          */}
          {bothFailedAlike ? (
            <div className="mb-3">
              <RelayFailure
                errors={[specList.error, specGraph.error]}
                subject={`spec pages or the state-machine graph for ${appId}`}
              />
            </div>
          ) : specList.isError || specGraph.isError ? (
            <div className="mb-3 space-y-2">
              {specList.isError && (
                <RelayFailure
                  errors={[specList.error]}
                  subject={`spec pages for ${appId}`}
                />
              )}
              {specGraph.isError && (
                <RelayFailure
                  errors={[specGraph.error]}
                  subject={`the state-machine graph for ${appId}`}
                />
              )}
            </div>
          ) : null}
          {specList.data && !specList.isError && (
            <>
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <Counter value={specs.length} label="pages" />
                {/*
                  States, transitions and graph nodes are claims about the
                  GRAPH, so each shows "—" until the graph read has actually
                  answered. It is a second query, independent of the spec list
                  gating this block: it can still be in flight, or have failed,
                  while the list beside it succeeded — and both of those look
                  exactly like a genuinely empty graph if a count is rendered
                  anyway.
                */}
                <Counter value={graph?.states} label="states" />
                <Counter value={graph?.transitions} label="transitions" />
                <Counter value={graph?.pages} label="graph nodes" />
              </div>
              {graph && graph.unreadablePages > 0 && (
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-500">
                  {graph.unreadablePages}{" "}
                  {graph.unreadablePages === 1
                    ? "graph page's IR"
                    : "graph pages' IR"}{" "}
                  could not be read on the runner; their states and transitions
                  are not counted above.
                </p>
              )}
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {specs.map((s) => {
                  const pageStates = graph?.statesByPage.get(s.specId);
                  return (
                    <li
                      key={s.specId}
                      className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
                    >
                      <code className="truncate text-xs">{s.specId}</code>
                      {pageStates !== undefined && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {pageStates} states
                        </span>
                      )}
                    </li>
                  );
                })}
                {specs.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    No spec pages found for this app.
                  </li>
                )}
              </ul>
            </>
          )}
        </section>

        {/* AUTOMATION-required side */}
        <section className="rounded-lg border border-l-4 border-l-indigo-500 bg-card p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Camera className="size-4" /> Live (automation)
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            A live UI Bridge snapshot of the runner&apos;s own window, captured
            on demand. It does not follow the App field — what it captured is
            shown with the result.
          </p>

          <CaptureSnapshotButton
            fetching={snapshot.isFetching}
            onCapture={() => {
              setSnapshotRequested(true);
              if (snapshotRequested) snapshot.refetch();
            }}
          />

          {snapshot.isError && snapshotRequested && (
            <RelayFailure
              errors={[snapshot.error]}
              subject="a live snapshot of the runner's window"
            />
          )}
          {snap && (
            <>
              <SnapshotSubject snap={snap} />
              {typeof snap.note === "string" && snap.note && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-500">
                  {snap.note}
                </p>
              )}
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <Counter
                  value={snapTree ? lengthOf(snap.elements) : undefined}
                  label="elements"
                />
                <Counter
                  value={snapTree ? lengthOf(snap.components) : undefined}
                  label="components"
                />
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed">
                {JSON.stringify(snap, null, 2)}
              </pre>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
