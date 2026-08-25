/**
 * The two bands the prompt-document list groups its kinds under, and the kind
 * roster they partition (plan
 * `2026-08-21-project-intent-documents-and-the-selection-loop`, Phase 3).
 *
 * Three properties are pinned here because each one fails silently otherwise:
 *
 * 1. **The roster is asserted as LITERAL strings, never as `KINDS[n]`.** A test
 *    written against its own constant pins nothing — it passes under a rename
 *    that breaks the DB CHECK these values mirror.
 * 2. **Behavior renders BEFORE Intent.** `session_briefing` is the most
 *    consequential document in the store and it lives in Behavior; rendering
 *    Intent first would push it below whatever `product_intent` rows exist,
 *    including an unedited shipped skeleton that is UNKNOWN rather than intent.
 * 3. **An empty band still renders, with its own line — unless emptiness is
 *    UNKNOWN.** An absent Intent band reads as "this product has no intent
 *    layer"; a "nothing here yet" line under a coord that could not be read
 *    would be the same lie in the other direction.
 *
 * The band constant's exhaustiveness is enforced by the TYPE CHECKER, not here:
 * `KIND_BAND` is a `Record<PromptDocumentKind, PromptDocumentBand>`, so a kind
 * added to the union without a band entry is a compile error (TS2741). A
 * runtime test could only observe the gap after tsc had already refused it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PromptDocumentList } from "./PromptDocumentList";
import type { PromptDocumentKind, PromptDocumentSummary } from "../types";
import {
  KIND_BAND,
  KIND_META,
  kindsInBand,
  PROMPT_DOCUMENT_BANDS,
  PROMPT_DOCUMENT_KINDS,
} from "../types";

function summary(
  kind: PromptDocumentKind,
  name: string
): PromptDocumentSummary {
  return {
    id: `doc-${kind}-${name}`,
    kind,
    name,
    description: null,
    format: "markdown",
    default_source: "prompt_doc/x/y/v1",
    current_version: 2,
    updated_by: "someone@example.com",
    updated_at: "2026-08-20T10:00:00Z",
  };
}

function renderList(
  documents: PromptDocumentSummary[],
  extra: { degraded?: string | null } = {}
) {
  getMock.mockResolvedValue({
    documents,
    degraded: extra.degraded ?? null,
  });
  return render(<PromptDocumentList />);
}

beforeEach(() => {
  getMock.mockReset();
});

describe("the kind roster", () => {
  it("carries all thirteen kinds, session_briefing first", () => {
    expect(PROMPT_DOCUMENT_KINDS).toEqual([
      "session_briefing",
      "product_intent",
      "initiative",
      "success_metric",
      "domain_spec",
      "audience_profile",
      "decision_record",
      "policy",
      "response_prompt",
      "continuation_rules",
      "agent_playbook",
      "prompt_template",
      "claude_settings",
    ]);
  });

  it("bands every kind, and only into the two declared bands", () => {
    for (const kind of PROMPT_DOCUMENT_KINDS) {
      expect(PROMPT_DOCUMENT_BANDS).toContain(KIND_BAND[kind]);
    }
    // No band entry for a kind that is not on the roster — the two constants
    // describe the same set.
    expect(Object.keys(KIND_BAND).sort()).toEqual(
      [...PROMPT_DOCUMENT_KINDS].sort()
    );
  });

  it("puts exactly the six intent kinds in the Intent band, in authority order", () => {
    expect(kindsInBand("intent")).toEqual([
      "product_intent",
      "initiative",
      "success_metric",
      "domain_spec",
      "audience_profile",
      "decision_record",
    ]);
  });

  it("keeps the behavioral kinds — claude_settings included — in Behavior", () => {
    expect(kindsInBand("behavior")).toEqual([
      "session_briefing",
      "policy",
      "response_prompt",
      "continuation_rules",
      "agent_playbook",
      "prompt_template",
      "claude_settings",
    ]);
  });

  it("describes each intent kind by the VERB a reader acts on", () => {
    // The description is the only place the verb is written down. A label
    // ("Success Metric") tells an operator nothing about when to reach for it.
    const verbs: Record<string, RegExp> = {
      product_intent: /justify/i,
      initiative: /rank/i,
      success_metric: /measure/i,
      domain_spec: /diff/i,
      audience_profile: /for whom/i,
      decision_record: /refuse/i,
    };
    for (const [kind, verb] of Object.entries(verbs)) {
      expect(KIND_META[kind as PromptDocumentKind].description).toMatch(verb);
    }
  });
});

describe("prompt-document list — bands", () => {
  it("renders Behavior above Intent so session_briefing stays first overall", async () => {
    renderList([
      summary("product_intent", "vision"),
      summary("session_briefing", "runner-session"),
    ]);

    const behavior = await screen.findByTestId("kind-band-behavior");
    const intent = screen.getByTestId("kind-band-intent");
    expect(
      behavior.compareDocumentPosition(intent) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // And the briefing really is inside the band that renders first.
    expect(
      within(behavior).getByTestId("doc-row-session_briefing-runner-session")
    ).toBeInTheDocument();
    expect(
      within(intent).getByTestId("doc-row-product_intent-vision")
    ).toBeInTheDocument();
  });

  it("shows the Intent band with its own empty line when nothing is authored", async () => {
    renderList([summary("policy", "operating-rules")]);

    const intent = await screen.findByTestId("kind-band-intent");
    const empty = within(intent).getByTestId("kind-band-empty-intent");
    expect(empty).toHaveTextContent(/No intent documents yet/i);
    // An ABSENT band would read as "this product has no intent layer".
    expect(intent).toHaveTextContent("Intent");
    // The populated band is unaffected and carries no empty line.
    const behavior = screen.getByTestId("kind-band-behavior");
    expect(
      within(behavior).queryByTestId("kind-band-empty-behavior")
    ).not.toBeInTheDocument();
    expect(
      within(behavior).getByTestId("doc-row-policy-operating-rules")
    ).toBeInTheDocument();
  });

  it("gives BOTH bands an empty line when the tenant has authored nothing", async () => {
    renderList([]);

    expect(await screen.findByTestId("kind-band-empty-behavior")).toBeVisible();
    expect(screen.getByTestId("kind-band-empty-intent")).toBeVisible();
  });

  it("asserts no emptiness while coord's store is unprovisioned", async () => {
    // `degraded` means the list is empty because it could not be READ. A
    // per-band "nothing here yet" would state a fact nobody established.
    renderList([], { degraded: "schema_migration_pending" });

    expect(
      await screen.findByTestId("prompt-documents-degraded")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("kind-band-empty-intent")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kind-band-empty-behavior")
    ).not.toBeInTheDocument();
  });

  it("asserts no emptiness when coord could not be reached", async () => {
    getMock.mockRejectedValue(new Error("boom"));
    render(<PromptDocumentList />);

    expect(
      await screen.findByTestId("prompt-documents-error")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("kind-band-empty-intent")
    ).not.toBeInTheDocument();
  });

  it("renders a group per populated intent kind, in authority order", async () => {
    renderList([
      summary("decision_record", "no-bidirectional-sync"),
      summary("initiative", "current-initiative"),
      summary("product_intent", "vision"),
    ]);

    const intent = await screen.findByTestId("kind-band-intent");
    const groups = Array.from(
      intent.querySelectorAll("[data-testid^='kind-group-']")
    ).map((el) => el.getAttribute("data-testid"));
    expect(groups).toEqual([
      "kind-group-product_intent",
      "kind-group-initiative",
      "kind-group-decision_record",
    ]);
  });
});
