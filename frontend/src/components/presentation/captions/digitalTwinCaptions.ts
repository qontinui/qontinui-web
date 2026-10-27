/**
 * Captions for the digital twin lens surface (`/digital-twin`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a panel of THIS page adds its entry here, keyed
 * `digital-twin.<panel>`, and never touches another surface's file. The key
 * prefix is enforced by `SurfaceCaptions<"digital-twin">`.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const DIGITAL_TWIN_CAPTIONS = {
  "digital-twin.page": {
    // The page's own title: `Caption` renders it as the page heading, and
    // Spec CI asserts a heading reading exactly "Digital Twin".
    title: "Digital Twin",
    oneLiner:
      "The environment your agents act in, the process they follow and the intent they serve: how much of each the twin observes, and how credibly.",
    // "The same model an agent can query" — the page reads the same
    // coord_query_* observers agents call. Not "an agent reads it before it
    // acts": nothing makes every agent do that.
    whyItMatters: copy`It is the same model an ${term("agent_session", "agent")} can query, and whatever the twin cannot observe is shown as ${term("unknown", "unknown")} rather than guessed.`,
  },
  // The Twin map tab (plan Phase 5): the page's landing view.
  "digital-twin.twin-map": {
    title: "Twin map",
    oneLiner: copy`Each part of the twin, how well it currently sees its share of the factory, and the ${term("plan", "plans")} moving it forward.`,
    // Each figure carries its source and age or is shown as unknown with the
    // reason; a plan's status is read from the work unit that tracks it. Not
    // "every plan opens its work unit": while presenting, a plan whose title
    // the lens withholds is not linked.
    whyItMatters: copy`Each figure is read from a named source and shown with its age, or shown as ${term("unknown", "unknown")} with the reason, and a ${term("plan", "plan")}'s status is read from the ${term("work_unit", "work unit")} that tracks it, so the map is read from the factory's own records rather than drawn for the occasion.`,
  },
  "digital-twin.aspect-environment": {
    title: "Environment twin",
    oneLiner:
      "The system being built and run: its code, dependencies, database schema, infrastructure, releases and runtime health.",
    // "Can query", as the page caption says: nothing makes every agent check
    // the twin before it acts.
    whyItMatters: copy`An ${term("agent_session", "agent")} can query this twin before it changes anything, so it can act on what is actually deployed rather than on what it assumes.`,
  },
  "digital-twin.aspect-process": {
    title: "Process twin",
    oneLiner: copy`The work in flight: ${term("work_unit", "work units")}, ${term("gate", "gates")}, ${term("agent_session", "agent sessions")}, CI runs and the ${term("merge_train", "merge train")}.`,
    whyItMatters:
      "It shows where work is moving and where it is stuck, from the same records the agents work from.",
  },
  "digital-twin.aspect-intent": {
    title: "Intent twin",
    oneLiner: copy`What the people running the factory want: ${term("policy", "policies")}, ${term("intent_document", "intent documents")} and the moments a person had to step in.`,
    whyItMatters:
      "It is where the factory's direction is written down: what is being built, for whom and what counts as better, so the work in flight can be ranked against it.",
  },
  "digital-twin.aspect-ui-bridge": {
    title: "UI Bridge app twin",
    oneLiner:
      "A model of each application's interface, its pages, states and the moves between them, read through the UI Bridge.",
    whyItMatters:
      "Agents verify an interface by operating it through the UI Bridge, so this model is what they can check a change against before a customer meets it.",
  },
  "digital-twin.aspect-detail": {
    title: "What it observes, and the plans moving it",
    // Not "every plan … with its live status": while presenting the list
    // shows at most eight unfinished plans and only counts the rest, and the
    // finished ones are counted, not listed (TwinPlanList).
    oneLiner: copy`The parts of the factory this twin observes, and the ${term("plan", "plans")} tied to them, unfinished ones first, with their live status.`,
    whyItMatters: copy`Each ${term("plan", "plan")}'s status is read from its ${term("work_unit", "work unit")}, which records its pull requests and status history.`,
  },
} as const satisfies SurfaceCaptions<"digital-twin">;
