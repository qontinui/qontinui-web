"use client";

/**
 * Panel 5 — controls and what they do: every component the runner's
 * interface registers, each action's DECLARED effect as a badge, and the
 * count of actions that declare none (`componentEffectStatus.ts`; served policy
 * `testing` `an-actions-safety-class-is-declared-not-re-derived`). An action
 * with no declared effect is UNDECLARED — counted, filtered and badged as
 * such — and never shown as a read.
 *
 * Whose components these are is stated, never implied. Over the relay the list
 * is the runner's own registry and no wrapper app is asked; the runner says so
 * in `wrapperComponents`, and the panel says it beside the counts with its
 * provenance. A reply that does not say (an older build) or says something
 * else is UNKNOWN there, never worded as either answer.
 *
 * Presentation mode (D3.3): component and action names are withheld (even the
 * runner's own entries embed runtime data that no repository clears —
 * `firstParty.ts`), so the audience sees the effect classes, their counts and
 * each component's descriptor; descriptions and raw ids are the operator's.
 */

import { useMemo, useState } from "react";
import { MousePointerClick } from "lucide-react";
import {
  FilterTabs,
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  ShareList,
  StatCluster,
  StatusBadge,
} from "@/components/console";
import {
  Provenance,
  RedactedText,
  usePresentationMode,
} from "@/components/presentation";
import {
  actionSplitText,
  componentEffectKind,
  componentStatusWord,
  EFFECT_ATTENTION_BY_KIND,
  EFFECT_KINDS,
  EFFECT_LABEL,
  EFFECT_MEANING,
  EFFECT_PALETTE,
  countEffects,
  wrapperDisclosureText,
  type ComponentActionRecord,
  type ComponentRecord,
  type ComponentsReading,
  type EffectKind,
  type WrapperDisclosure,
} from "../_lib/componentEffectStatus";
import type { ReadState } from "../_lib/readState";
import { RUNNER_ROUTES } from "../_lib/relayReads";
import { sourceIssueText, type BuildReading } from "../_lib/relaySource";
import { DashboardPanel } from "./DashboardPanel";
import {
  RunnerReadUnknown,
  SourceUnknown,
  StaleReadNote,
} from "./SourceUnknown";

export interface ComponentActionsPanelProps {
  components: ReadState<ComponentsReading>;
  build: BuildReading;
  noRunner: string | null;
}

/** The list filter: everything, or the components carrying one kind. */
type ComponentFilter = "all" | EffectKind;

/**
 * The filter tabs count COMPONENTS (a component with at least one action of
 * the kind), where the stats above them count ACTIONS. So each tab names its
 * referent in words — "With an undeclared action", under a "Components:"
 * lead-in — and no tab shares a label with a stat (served policy
 * `ux-priorities` `a-label-names-one-referent-and-a-quantity-names-its-unit`).
 */
const FILTERS: ReadonlyArray<{ id: ComponentFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "undeclared", label: "With an undeclared action" },
  { id: "destructive", label: "With a destructive action" },
  { id: "write", label: "With a write action" },
  { id: "read", label: "With a read action" },
];

function matches(component: ComponentRecord, filter: ComponentFilter): boolean {
  return filter === "all" || component.actions.some((a) => a.effect === filter);
}

const isoOf = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();

function EffectBadge({ kind }: { kind: EffectKind }) {
  return (
    <StatusBadge
      status={{
        kind,
        label: EFFECT_LABEL[kind],
        reason: EFFECT_MEANING[kind],
        attention: EFFECT_ATTENTION_BY_KIND[kind],
      }}
      palette={EFFECT_PALETTE}
    />
  );
}

/**
 * Whose components the list holds, stated beside the counts. The two answers
 * the runner can give are calm facts about the list; a disclosure it did not
 * make is UNKNOWN, and so is its time — no time came with a claim nobody made.
 */
function WrapperDisclosureLine({
  disclosure,
  asOf,
}: {
  disclosure: WrapperDisclosure;
  asOf: number | null;
}) {
  const text = wrapperDisclosureText(disclosure);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="coord-ui-bridge-actions-wrappers"
      data-wrappers={disclosure.kind}
    >
      {disclosure.kind === "unknown" ? (
        <SourceUnknown text={text} className="text-xs" />
      ) : (
        <span className="text-xs text-muted-foreground">{text}</span>
      )}
      <Provenance
        source="the runner's component registry"
        asOf={disclosure.kind === "unknown" ? null : asOf}
      />
    </div>
  );
}

function ActionLine({
  action,
  presenting,
}: {
  action: ComponentActionRecord;
  presenting: boolean;
}) {
  return (
    <li
      className="flex flex-wrap items-baseline gap-2"
      data-testid="coord-ui-bridge-action"
      data-effect={action.effect}
    >
      <EffectBadge kind={action.effect} />
      <span className="text-sm">
        {action.unreadable ? (
          // The page's own words: the entry carried nothing to quote.
          "Unreadable entry"
        ) : (
          <RedactedText
            text={action.label ?? action.id ?? "unnamed action"}
            repo={null}
            descriptor={{ kind: "Action", status: EFFECT_LABEL[action.effect] }}
          />
        )}
      </span>
      {action.unreadable && (
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-action-unreadable"
        >
          (the runner sent an entry here that is not an action, so it counts
          as undeclared)
        </span>
      )}
      {!presenting && action.description && (
        <span className="text-xs text-muted-foreground">
          {action.description}
        </span>
      )}
      {!presenting && action.unrecognisedEffect !== undefined && (
        <span className="text-xs text-muted-foreground">
          (declares “{action.unrecognisedEffect}”, which is not an effect class,
          so it counts as undeclared)
        </span>
      )}
    </li>
  );
}

export function ComponentActionsPanel({
  components,
  build,
  noRunner,
}: ComponentActionsPanelProps) {
  const { presenting } = usePresentationMode();
  const [filter, setFilter] = useState<ComponentFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const reading = components.state === "ok" ? components.value : null;
  const counts = useMemo(
    () => (reading ? countEffects(reading) : null),
    [reading]
  );
  const visible = useMemo(
    () => (reading ? reading.components.filter((c) => matches(c, filter)) : []),
    [reading, filter]
  );
  const filterCounts = useMemo(() => {
    const out: Record<ComponentFilter, number | null> = {
      all: null,
      undeclared: null,
      destructive: null,
      write: null,
      read: null,
    };
    if (!reading) return out;
    for (const f of FILTERS) {
      out[f.id] = reading.components.filter((c) => matches(c, f.id)).length;
    }
    return out;
  }, [reading]);

  return (
    <DashboardPanel
      captionId="ui-bridge.component-actions"
      icon={
        <MousePointerClick
          className="h-4 w-4 text-muted-foreground"
          aria-hidden
        />
      }
      summary={
        <span
          className="text-xs text-muted-foreground"
          data-testid="coord-ui-bridge-actions-summary"
        >
          {counts ? counts.actions : "–"} actions ·{" "}
          {counts ? counts.undeclared : "–"} undeclared
        </span>
      }
      data-testid="coord-ui-bridge-actions"
    >
      {noRunner !== null ? (
        <SourceUnknown
          text={sourceIssueText(
            { kind: "no-runner", reason: noRunner },
            RUNNER_ROUTES.components,
            build
          )}
          data-testid="coord-ui-bridge-actions-unknown"
        />
      ) : components.state === "failed" ? (
        <RunnerReadUnknown
          issue={components.issue}
          route={RUNNER_ROUTES.components}
          build={build}
          data-testid="coord-ui-bridge-actions-unknown"
        />
      ) : reading === null || counts === null ? (
        <p className="m-0 text-sm text-muted-foreground">
          Reading the component registry…
        </p>
      ) : (
        <>
          {components.state === "ok" && components.stale && (
            <StaleReadNote
              asOf={components.asOf}
              data-testid="coord-ui-bridge-actions-stale"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StatCluster
              data-testid="coord-ui-bridge-actions-counts"
              stats={[
                {
                  key: "components",
                  label: "components ",
                  value: counts.components,
                },
                { key: "actions", label: "actions ", value: counts.actions },
                ...EFFECT_KINDS.map((kind) => ({
                  key: kind,
                  // Each counts ACTIONS, and says so: the tabs below count
                  // components.
                  label: `${EFFECT_LABEL[kind]} actions `,
                  value: counts[kind],
                  tone:
                    kind === "undeclared" && counts.undeclared > 0
                      ? ("warning" as const)
                      : ("default" as const),
                  title: EFFECT_MEANING[kind],
                  "data-testid": `coord-ui-bridge-actions-count-${kind}`,
                })),
              ]}
            />
            <Provenance
              source="the runner's component registry"
              asOf={components.state === "ok" ? components.asOf : null}
            />
          </div>
          <WrapperDisclosureLine
            disclosure={reading.wrappers}
            asOf={components.state === "ok" ? components.asOf : null}
          />
          {reading.unreadable > 0 && (
            <p
              className="m-0 text-xs text-muted-foreground"
              data-testid="coord-ui-bridge-actions-unreadable"
            >
              {reading.unreadable}{" "}
              {reading.unreadable === 1 ? "entry" : "entries"} in the registry
              could not be read and {reading.unreadable === 1 ? "is" : "are"}{" "}
              not counted, so the totals are a floor.
            </p>
          )}
          <ShareList
            data-testid="coord-ui-bridge-actions-effects"
            items={EFFECT_KINDS.map((kind) => ({
              key: kind,
              label: EFFECT_LABEL[kind],
              count: counts[kind],
              title: EFFECT_MEANING[kind],
            }))}
            total={counts.actions}
            unit="actions"
            empty={null}
          />
          <div
            className="flex flex-wrap items-center gap-1.5"
            data-testid="coord-ui-bridge-actions-filters"
          >
            <span className="text-xs text-muted-foreground">Components:</span>
            <FilterTabs
              // No tab borrows the attention red: an undeclared action is
              // R3's ignorance floor (amber), not something a human must act
              // on now.
              tabs={FILTERS.map((f) => ({
                id: f.id,
                label: f.label,
                count: filterCounts[f.id],
              }))}
              active={filter}
              onChange={(id) => {
                setFilter(id);
                setExpandedKey(null);
              }}
              testIdPrefix="coord-ui-bridge-actions-filter"
            />
          </div>
          <RecordList
            items={visible}
            itemKey={(c) => c.key}
            expandedKey={expandedKey}
            onExpandedKeyChange={setExpandedKey}
            empty={
              <p
                className="m-0 text-sm text-muted-foreground"
                data-testid="coord-ui-bridge-actions-empty"
              >
                {reading.components.length === 0
                  ? "The runner's interface registers no components on its current screen."
                  : "No component has an action of this kind."}
              </p>
            }
            renderRow={(component, ctx) => {
              const kind = componentEffectKind(component);
              return (
                <RecordRow
                  identity={presenting ? "component" : (component.id ?? "–")}
                  label={
                    <RedactedText
                      text={
                        component.name ?? component.id ?? "unnamed component"
                      }
                      repo={null}
                      descriptor={{
                        kind: "Component",
                        area:
                          component.scope === null
                            ? null
                            : component.scope === "global"
                              ? "any screen"
                              : "one screen",
                        status: componentStatusWord(component),
                        at: isoOf(component.registeredAt),
                      }}
                    />
                  }
                  status={
                    kind === null ? undefined : <EffectBadge kind={kind} />
                  }
                  reason={actionSplitText(component)}
                  attention={
                    kind === null ? undefined : EFFECT_ATTENTION_BY_KIND[kind]
                  }
                  time={
                    <RowTime
                      at={isoOf(component.registeredAt)}
                      verb="Registered"
                      absent={{
                        label: "–",
                        title: "The runner did not say when it registered",
                      }}
                    />
                  }
                  expanded={ctx.expanded}
                  onToggle={ctx.onToggle}
                  data-testid="coord-ui-bridge-component-row"
                >
                  <RecordDetail
                    why={
                      !presenting && component.description ? (
                        <p className="m-0">{component.description}</p>
                      ) : undefined
                    }
                    problems={
                      component.actions.some(
                        (a) => a.effect === "undeclared"
                      ) ? (
                        <p
                          className="m-0 text-xs"
                          data-testid="coord-ui-bridge-component-undeclared"
                        >
                          {
                            component.actions.filter(
                              (a) => a.effect === "undeclared"
                            ).length
                          }{" "}
                          of its actions declare no effect, so an automated walk
                          must treat them as unknown — they are counted as
                          undeclared, never as reads.
                        </p>
                      ) : undefined
                    }
                    actions={
                      component.actions.length > 0 ? (
                        <ul className="m-0 list-none space-y-1.5 p-0">
                          {component.actions.map((action, i) => (
                            <ActionLine
                              key={`${action.id ?? "action"}#${i}`}
                              action={action}
                              presenting={presenting}
                            />
                          ))}
                        </ul>
                      ) : undefined
                    }
                    history={
                      <p className="m-0 text-xs text-muted-foreground">
                        {component.scope === "global"
                          ? "Available on any screen"
                          : component.scope === "route"
                            ? "Available while its screen is open"
                            : "Scope not reported"}
                        {component.mounted === false ? " · not mounted" : ""}.
                      </p>
                    }
                    raw={
                      presenting ? undefined : (
                        <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
                          component {component.id ?? "–"} · actions{" "}
                          {component.actions
                            .map((a) => a.id ?? "–")
                            .join(", ") || "none"}
                        </p>
                      )
                    }
                  />
                </RecordRow>
              );
            }}
          />
        </>
      )}
    </DashboardPanel>
  );
}
