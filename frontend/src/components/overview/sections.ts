/**
 * The Project Overview section's pages — the ONE list both the app sidebar
 * (`navigation/sidebar/nav-items.ts`) and the overview's own sub-navigation
 * (`app/(app)/overview/_components/OverviewShell.tsx`) are built from, so the
 * two can never disagree about which pages exist or what they are called.
 *
 * The overview is written for business leaders overseeing a project (plan
 * `2026-09-19-project-overview-for-business-leaders`), so labels and
 * descriptions are plain language rather than the console's vocabulary.
 */

import {
  BookOpen,
  CalendarRange,
  FileText,
  LayoutDashboard,
  Presentation,
  ShieldAlert,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface OverviewSection {
  /** Sidebar id and UI Bridge id suffix. */
  id: string;
  label: string;
  route: string;
  icon: LucideIcon;
  /** What the page answers, in the reader's words. */
  description: string;
  /**
   * False while the page is still a placeholder. The sub-navigation marks
   * such pages with an icon (a shape, not colour alone) so a reader is not
   * surprised by an empty screen.
   */
  available: boolean;
}

export const OVERVIEW_ROOT = "/overview";

export const OVERVIEW_SECTIONS: readonly OverviewSection[] = [
  {
    id: "overview-summary",
    label: "Summary",
    route: OVERVIEW_ROOT,
    icon: LayoutDashboard,
    description: "What this project is, who it is for, and where it stands",
    available: true,
  },
  {
    id: "overview-timeline",
    label: "Timeline",
    route: "/overview/timeline",
    icon: CalendarRange,
    description: "Phases, gates and milestones, planned against actual",
    available: false,
  },
  {
    id: "overview-costs",
    label: "Costs",
    route: "/overview/financials",
    icon: Wallet,
    description: "What the project has cost, compared with its estimate",
    available: false,
  },
  {
    id: "overview-team",
    label: "Team",
    route: "/overview/team",
    icon: Users,
    description: "Roles, allocation by phase, and who is doing the work",
    available: true,
  },
  {
    id: "overview-risks",
    label: "Risks & Decisions",
    route: "/overview/risks",
    icon: ShieldAlert,
    description: "What could go wrong, and which decisions are still open",
    available: false,
  },
  {
    id: "overview-diagrams",
    label: "Diagrams",
    route: "/overview/diagrams",
    icon: Workflow,
    description: "How the pieces fit together, drawn for a non-engineer",
    available: false,
  },
  {
    id: "overview-documents",
    label: "Documents",
    route: "/overview/documents",
    icon: FileText,
    description: "Briefs, plans, contracts and reports",
    available: true,
  },
  {
    id: "overview-wiki",
    label: "Wiki",
    route: "/overview/wiki",
    icon: BookOpen,
    description: "The project's terms and topics, explained in plain language",
    available: true,
  },
  {
    id: "overview-slides",
    label: "Slides",
    route: "/overview/slides",
    icon: Presentation,
    description: "Decks to present, built from the project's own material",
    available: false,
  },
];

export function findOverviewSection(
  pathname: string
): OverviewSection | undefined {
  // Longest route first, so `/overview/timeline` wins over `/overview`.
  return [...OVERVIEW_SECTIONS]
    .sort((a, b) => b.route.length - a.route.length)
    .find((s) => pathname === s.route || pathname.startsWith(s.route + "/"));
}
