"use client";

/**
 * DashboardPanel — one section of the UI Bridge dashboard: a
 * `CollapsiblePanel` (style guide R7: its summary stays visible while
 * closed) whose content opens with the section's presentation caption.
 *
 * The caption comes before the data (plan
 * `2026-10-23-console-presentation-spaces` D1, "captions on"; it renders only
 * in presentation mode), and the panel's title is READ from the same caption
 * entry, so the console header and the presentation headline cannot name a
 * section two ways. While presenting, every panel is held open: a collapsed
 * section would hide its caption and its figures from the audience, and an
 * evaluator should not have to find the disclosure.
 */

import type { ReactNode } from "react";
import { CollapsiblePanel } from "@/components/console";
import {
  Caption,
  captionEntry,
  usePresentationMode,
  type CaptionKey,
} from "@/components/presentation";

export interface DashboardPanelProps {
  /** The section's caption — also the source of its title. */
  captionId: CaptionKey;
  icon?: ReactNode;
  /** Counts kept visible in the header, even while collapsed. */
  summary?: ReactNode;
  /** Controls beside the title (refresh, run). Rendered outside the toggle. */
  headerActions?: ReactNode;
  children: ReactNode;
  "data-testid": string;
}

export function DashboardPanel({
  captionId,
  icon,
  summary,
  headerActions,
  children,
  "data-testid": testId,
}: DashboardPanelProps) {
  const { presenting } = usePresentationMode();
  return (
    <CollapsiblePanel
      title={captionEntry(captionId).title}
      icon={icon}
      summary={summary}
      headerActions={headerActions}
      forceOpen={presenting}
      data-testid={testId}
      data-ui-bridge-id={testId}
    >
      <div className="space-y-3">
        <Caption id={captionId} level={3} />
        {children}
      </div>
    </CollapsiblePanel>
  );
}
