/**
 * Captions for the agentic activity lens surface (`/admin/coord/spawns`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a panel of THIS page adds its entry here, keyed
 * `agentic-activity.<panel>`, and never touches another surface's file.
 *
 * Phase 4 captions every section the page renders, in page order: the spawn
 * paths and their switches, the machines, the spawn requests (the strip and
 * their counts), where they were placed (counted), and the hourly rates. Each sentence says
 * only what that section shows, and is true against coord; and since the
 * page's captions are read together on one screen, a point made once (an
 * unread value is unknown) is not made again by a section.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const AGENTIC_ACTIVITY_CAPTIONS = {
  "agentic-activity.page": {
    title: "Agentic activity",
    // The three things the page shows, in its order: the spawn paths and
    // their switches (the matrix — the system's own paths, and the console's
    // launcher, which a person uses), the machines that host the sessions,
    // and the record of every request (the ledger, which holds both kinds).
    oneLiner: copy`The paths that start an ${term("agent_session", "agent session")} — by the system on its own, or by a person from the console — with the switches that control each, the machines those sessions run on, and every session the ${term("coord", "coordination service")} was asked to start.`,
    whyItMatters: copy`Each automatic path can be switched off by the people it acts for, so the page shows what each switch reads, which machines are taking new work and how every request ended — and anything it could not read is shown as ${term("unknown")}, never as on or as none.`,
  },
  "agentic-activity.spawn-paths": {
    title: "Spawn paths",
    // Not "every path": a runner's looping agents, workflows and restart resumes
    // have no line, and the list of spawn requests does not record them (the
    // section's note says both).
    oneLiner: copy`The paths this console knows of that start an ${term("agent_session", "agent session")}, with every switch this page can read that controls each: where the switch is set, at what scope, and whether it is enforced.`,
    // True against coord: every registry row seeds `default_enabled: true`
    // (the spawn contract), while the next-step and red-main dispatch arms
    // ship dormant — their fleet flags are "Default OFF" (`next_step.rs`) and
    // both domains default to Guidance only (`next_step_settings.rs`). The
    // page caption already says an unread value is unknown; this one does not
    // repeat it.
    whyItMatters: copy`A path's own switch ships on, but several paths also wait on a project or deployment setting that ships off — dispatching the next step and fixing a failing main branch among them — so a line lists those switches beside its own, each with the value the system reads from it.`,
  },
  "agentic-activity.machines": {
    title: "Machines",
    oneLiner: copy`Every ${term("device", "machine")} that can host sessions: whether it is taking new work, what kind of work it may take, and how many sessions it has open now.`,
    // What the list shows and nothing about placement it does not: a drained
    // machine is refused new sessions (coord's drain interlock), and a role
    // closes lanes. How much work each carries against its ceiling is not
    // offered to this page; the section's own note says so, and the page
    // caption already says an unread value is unknown.
    whyItMatters: copy`A machine taken out of service with a ${term("drain")}, or limited to one kind of work, is sent no new sessions, so each machine's standing is visible before any work is placed on it.`,
  },
  "agentic-activity.requests": {
    title: "Spawn requests",
    // Counts on this page; the list itself is the operator's investigation view.
    oneLiner: copy`How many requests the ${term("coord", "coordination service")} received to start a session in the window, and how they ended.`,
    whyItMatters:
      "A session counts as finished only when it reported its own work finished, so a request that started is never counted as work done.",
  },
  "agentic-activity.placement": {
    title: "Where requests were placed",
    oneLiner:
      "How many requests were placed on a machine in the window, and across how many machines.",
    whyItMatters:
      "Requests spread across few machines show work piling up before any one of them falls behind.",
  },
  "agentic-activity.rate": {
    title: "Requested versus started per hour",
    oneLiner:
      "How many sessions were requested each hour, against how many of those requests started.",
    whyItMatters:
      "The requested line is the best possible rate, with every request starting on its first attempt, so a widening gap between the two lines means requests are waiting.",
  },
} as const satisfies SurfaceCaptions<"agentic-activity">;
