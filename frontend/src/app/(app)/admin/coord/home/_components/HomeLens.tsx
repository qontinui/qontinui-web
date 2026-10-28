"use client";

/**
 * The presentation lens's pieces of `/admin/coord/home` that are not a region
 * of their own (plan `2026-10-23-console-presentation-spaces` Phase 2; style
 * guide §3.13): each region's caption with the provenance of its figures, the
 * notice that leads a kept reading, the refresh control's UI Bridge
 * registration, and how a degradation's subject is named.
 *
 * Operator mode renders nothing here that #1999's page did not: the caption
 * and the notice render only while presenting, and the refresh button is the
 * same button, now registered with its effect declared.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { RefreshButton } from "@/components/console";
import {
  Provenance,
  SectionCaption,
  lensLinkTarget,
  useMachineAliaser,
  usePresentationMode,
  useRedactor,
} from "@/components/presentation";
import {
  degradationSubjectText,
  type DegradationView,
} from "@/components/admin/coord/coordHomeStatus";
import { FAILURE_REASON_WITHHELD } from "@/components/operations/presentedFailure";
import {
  PROJECT_STATE_KEPT_SOURCE,
  RowKeyAliases,
  degradationRepo,
  isMachineSubject,
  regionSources,
  subjectDescriptor,
  type DegradationRowKind,
  type HomeReading,
} from "../_lib/homeLens";

/** The page's six regions, as their captions are keyed. */
export type HomeRegion =
  | "strip"
  | "needs-you"
  | "degrading"
  | "on-track"
  | "correct"
  | "does-not-know";

/**
 * A region's caption and the provenance of its figures — presentation mode
 * only (`SectionCaption` renders nothing for the operator). Every region
 * renders the one project-state read, so its single chip names that read
 * and dates it by coord's answer.
 */
export function RegionCaption({
  region,
  reading,
}: {
  region: HomeRegion;
  reading: HomeReading;
}) {
  return (
    <SectionCaption
      id={`coordination-overview.${region}`}
      sources={regionSources(reading)}
      data-testid={`coord-home.${region}.caption`}
    />
  );
}

/**
 * What leads a kept reading while presenting (style guide §6.5, "A kept
 * reading"): the latest read failed, so everything below is the LAST reading
 * — said first, named as such, and dated by its read, never shown as current.
 * The failure's own text can quote a URL or coord's error body, so its reason
 * is the page's fixed words where it has some (`presentedHomeFailure`), and
 * withheld otherwise. Operator mode has the strip's own stale qualifier and
 * renders nothing here.
 */
export function KeptReadingNotice({
  reading,
  failure,
}: {
  reading: HomeReading;
  /** The latest failure as a presentation may show it (`presentedHomeFailure`). */
  failure: string | null;
}) {
  const { presenting } = usePresentationMode();
  if (!presenting || !reading.kept) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
      role="status"
      data-testid="coord-home.kept-reading"
    >
      <span>
        The latest read of coord&apos;s project state failed (
        {failure ?? FAILURE_REASON_WITHHELD}). Everything below is its last
        reading, not a current one.
      </span>
      <Provenance
        source={PROJECT_STATE_KEPT_SOURCE}
        asOf={reading.generatedAt}
      />
    </div>
  );
}

/** The refresh control's UI Bridge id (and testid). */
export const HOME_REFRESH_ID = "coord-home.refresh";

/** The action an automated walk fires on it. */
export const HOME_REFRESH_ACTION = "refresh";

/**
 * The page's refresh: the console's `RefreshButton`, registered with the UI
 * Bridge where it renders, its one action declared a READ — a re-read changes
 * nothing but what this page shows, so it stays live in presentation mode
 * (D3.2), and an automated walk can see that rather than having to guess.
 */
export function HomeRefreshButton({
  onRefresh,
}: {
  onRefresh: () => Promise<void>;
}) {
  // The SDK keeps the handler it registered with (it re-registers only when a
  // declaration changes), so the handler reads the latest refresh by ref.
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  }, [onRefresh]);
  const customActions = useMemo(
    () => ({
      [HOME_REFRESH_ACTION]: {
        id: HOME_REFRESH_ACTION,
        label: "Refresh project state",
        description:
          "Re-read coord's project state now instead of waiting for the next minute. It changes nothing but what this page shows.",
        effect: "read" as const,
        handler: async () => {
          await latest.current();
        },
      },
    }),
    []
  );
  const { ref } = useUIElement({
    id: HOME_REFRESH_ID,
    label: "Refresh project state",
    type: "button",
    customActions,
  });
  return (
    <RefreshButton
      ref={ref}
      onRefresh={onRefresh}
      label="Refresh project state"
      title="Re-read coord's project state now instead of waiting for the next minute"
      data-testid={HOME_REFRESH_ID}
    />
  );
}

/**
 * Whether a link to `href` opens anything in this mode — `LensLink`'s own
 * decision (`lensLinkTarget`, with "no lens above" read as operator mode, as
 * `LensLink` reads it): always for the operator; while presenting, only when
 * its page can be presented. Where it cannot, `LensLink` renders plain text,
 * and "Open pipeline ↗" or "open Questions" in plain text is a dead end in
 * front of an evaluator (`audience_profile/external-evaluator`: "no dead
 * ends"), so the page leaves the action out instead. It comes back by itself
 * the day its page is registered presentation-ready.
 */
export function useLinkOpens(): (href: string) => boolean {
  const { presenting, source } = usePresentationMode();
  return useCallback(
    (href: string) =>
      lensLinkTarget(href, presenting && source !== "absent") !== null,
    [presenting, source]
  );
}

/**
 * A list row's key in this mode: the page's own key for the operator; while
 * presenting, its alias (`RowKeyAliases`), so `data-row-key` carries no id
 * and the open row is the record that was opened, as it is for the operator.
 * The registry lives as long as the region is mounted, so a row keeps its
 * alias across polls.
 */
export function useRowKey(): (list: string, operatorKey: string) => string {
  const { presenting } = usePresentationMode();
  const [aliases] = useState(() => new RowKeyAliases());
  return useCallback(
    (list: string, operatorKey: string) =>
      presenting ? aliases.key(list, operatorKey) : operatorKey,
    [presenting, aliases]
  );
}

/**
 * A degradation's subject for the collapsed row. For the operator, its name
 * (`degradationSubjectText`). While presenting: a machine is its
 * session alias, a repository shows only when the scope clears it, and any
 * other subject — a cloud resource, an alert key — is its descriptor (D3.3).
 */
export function useSubjectText(): (
  d: DegradationView,
  kind: DegradationRowKind
) => string {
  const { presenting } = usePresentationMode();
  const alias = useMachineAliaser();
  const redact = useRedactor();
  return (d, kind) => {
    const operatorText = degradationSubjectText(d);
    if (!presenting) return operatorText;
    if (isMachineSubject(d)) {
      return alias({ deviceId: d.subjectId, hostname: d.subjectName });
    }
    if (d.subjectName === null) return operatorText;
    return redact({
      text: d.subjectName,
      repo: degradationRepo(d),
      descriptor: subjectDescriptor(d, kind),
    });
  };
}
