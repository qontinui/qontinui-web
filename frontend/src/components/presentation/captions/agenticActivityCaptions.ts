/**
 * Captions for the agentic activity lens surface (`/admin/coord/spawns`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a panel of THIS page adds its entry here, keyed
 * `agentic-activity.<panel>`, and never touches another surface's file.
 *
 * Phase 4 captions every section the page renders, in page order: the spawn
 * paths and their switches, the machines, the spawn requests (the strip and
 * the list), where they were placed, and the hourly rates. Each sentence says
 * only what that section shows.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const AGENTIC_ACTIVITY_CAPTIONS = {
  "agentic-activity.page": {
    title: "Agentic activity",
    // The three things the page shows, in its order: the automatic paths and
    // their switches (the matrix), the machines that host the sessions, and
    // the record of every request (the ledger, which holds person-started
    // sessions too — so not "started on its own" for that half).
    oneLiner: copy`Every way the system starts an ${term("agent_session", "agent session")} on its own and the switch that controls each one, the machines those sessions run on, and every session the ${term("coord", "coordination service")} was asked to start.`,
    whyItMatters: copy`Each automatic path can be switched off by the people it acts for, so the page shows what each switch reads, which machines are taking new work, and how every request ended, and anything it could not read is shown as ${term("unknown")} rather than as on or as none.`,
  },
  "agentic-activity.spawn-paths": {
    title: "Spawn paths",
    oneLiner: copy`Every path by which an ${term("agent_session", "agent session")} starts without a person asking, with the switch that controls it, where that switch is set, and whether it is enforced.`,
    // `agent-spawn-authorization`: a standing path is on by default, with an
    // off-switch at the scope its preference belongs to; the matrix shows each
    // switch's own served value and never folds several into one verdict.
    whyItMatters: copy`Every automatic path starts switched on and can be switched off for the whole project, one repository or one machine, so each line shows where its switch lives and the value the system reads from it; a path governed by several switches lists them all, and a value that could not be read is shown as ${term("unknown")}, never as on.`,
  },
  "agentic-activity.machines": {
    title: "Machines",
    oneLiner: copy`Every ${term("device", "machine")} that can host sessions: whether it is taking new work, what kind of work it may take, and how many sessions it has open now.`,
    // What the list shows and nothing about placement it does not: a drained
    // machine is refused new sessions (coord's drain interlock), and a role
    // closes lanes; how much work each carries against its ceiling is shown
    // as unknown because no console door reads it yet.
    whyItMatters: copy`A machine taken out of service with a ${term("drain")}, or limited to one kind of work, is sent no new sessions, so each machine's standing is visible before any work is placed on it, and a figure nobody measured is shown as ${term("unknown")} instead of zero.`,
  },
  "agentic-activity.requests": {
    title: "Spawn requests",
    oneLiner: copy`Every request the ${term("coord", "coordination service")} received to start a session: where it went, how long it waited, and how it ended.`,
    whyItMatters:
      "Each request names where it came from, so what the system starts on its own and what a person asked for can be told apart, and a session counts as finished only when it reported its own work finished.",
  },
  "agentic-activity.placement": {
    title: "Where requests were placed",
    oneLiner:
      "How many requests each machine was given in the window, and how many of them started, were refused and were deferred.",
    whyItMatters:
      "A share that piles onto one machine shows at a glance, before that machine falls behind.",
  },
  "agentic-activity.rate": {
    title: "Requested versus started per hour",
    oneLiner:
      "How many sessions were requested each hour, against how many of those requests started.",
    whyItMatters:
      "The requested line is the best possible rate, with every request starting on its first attempt, so a widening gap between the two lines means requests are waiting.",
  },
} as const satisfies SurfaceCaptions<"agentic-activity">;
