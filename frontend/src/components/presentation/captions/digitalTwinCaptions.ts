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
    whyItMatters: copy`An ${term("agent_session", "agent")} reads this same model before it acts, so whatever the twin cannot observe is shown as ${term("unknown", "unknown")} rather than guessed.`,
  },
  // The Twin map tab (plan Phase 5): the page's landing view.
  "digital-twin.twin-map": {
    title: "Twin map",
    oneLiner: copy`Each part of the twin, how well it currently sees its share of the factory, and the ${term("plan", "plans")} moving it forward.`,
    whyItMatters: copy`Every figure is a live reading shown with its source and age, and every ${term("plan")} opens the ${term("work_unit", "work unit")} that tracks it, so the map is the factory's own record rather than a slide.`,
  },
  "digital-twin.aspect-environment": {
    title: "Environment twin",
    oneLiner:
      "The system being built and run: its code, dependencies, database schema, infrastructure, releases and runtime health.",
    whyItMatters: copy`An ${term("agent_session", "agent")} checks this twin before it changes anything, so it acts on what is actually deployed rather than on what it assumes.`,
  },
  "digital-twin.aspect-process": {
    title: "Process twin",
    oneLiner: copy`The work in flight: ${term("work_unit", "work units")}, ${term("gate", "gates")}, agent sessions, CI runs and the ${term("merge_train", "merge train")}.`,
    whyItMatters:
      "It shows where work is moving and where it is stuck, so the factory can route around a blockage instead of waiting for a person to notice it.",
  },
  "digital-twin.aspect-intent": {
    title: "Intent twin",
    oneLiner: copy`What the people running the factory want: ${term("policy", "policies")}, ${term("intent_document", "intent documents")} and the moments a person had to step in.`,
    whyItMatters:
      "It is what the other two twins are judged against: work counts only when it serves the intent written down here.",
  },
  "digital-twin.aspect-ui-bridge": {
    title: "UI Bridge app twin",
    oneLiner:
      "A model of each application's interface, its pages, states and the moves between them, read through the UI Bridge.",
    whyItMatters:
      "Agents test and operate an interface through this model, so a change that breaks a page is caught by the factory rather than by a customer.",
  },
  "digital-twin.aspect-detail": {
    title: "What it observes, and the plans moving it",
    oneLiner: copy`The parts of the factory this twin observes, and every ${term("plan")} tied to them with its live status.`,
    whyItMatters: copy`Each ${term("plan")} opens its ${term("work_unit", "work unit")}, where its pull requests and status history are recorded.`,
  },
} as const satisfies SurfaceCaptions<"digital-twin">;
