/**
 * Page-level navigation the sub-space drawer uses to act on its "On this page"
 * answer: a row whose coord tool is askable from Ask the Twin gets a button
 * that opens the Completeness tab with a question about it already typed in;
 * a row read on the Delivery tab gets a button that opens that tab.
 *
 * The drawer is rendered by both the matrix and the Lifecycle view, so the
 * page provides these actions through context rather than props. Without a
 * provider (a component rendered on its own, as in its unit tests) the
 * context is `null` and the drawer shows no action buttons.
 */

import { createContext, useContext } from "react";
import type { ResolvedSubspace } from "./types";

/** The Explorer's tabs, by their `TabsTrigger` value. */
export type TwinTab = "completeness" | "lifecycle" | "delivery" | "ui-bridge";

export interface TwinNavigation {
  /** Open the Completeness tab with `question` typed into Ask the Twin. */
  askTheTwin: (question: string) => void;
  /** Switch the Explorer to `tab`. */
  openTab: (tab: TwinTab) => void;
}

export const TwinNavigationContext = createContext<TwinNavigation | null>(null);

export function useTwinNavigation(): TwinNavigation | null {
  return useContext(TwinNavigationContext);
}

/**
 * The question the drawer pre-fills for a row: names the sub-space and the
 * coord tool that answers it, and asks for the envelope the twin preamble
 * already requires. The operator can edit it before asking.
 */
export function askTheTwinQuestion(
  row: Pick<ResolvedSubspace, "id" | "symbol" | "coord_query_tool">
): string {
  const name = row.id.replace(/_/g, " ");
  const tool = row.coord_query_tool ? ` Use ${row.coord_query_tool}.` : "";
  return (
    `What does the ${name} sub-space (${row.symbol}) observe right now?${tool}` +
    " Report its coverage, credibility and staleness."
  );
}
