/**
 * The `session_briefing` list surface, for the rows the runner never reads.
 *
 * `PromptDocumentBodyRules.test.tsx` pins the create dialog's warning, which
 * catches an operator about to take an inert address. It cannot catch the two
 * ways such a row arrives without anyone typing it in this form:
 *
 * - a row seeded or created before that warning shipped, and
 * - a row an AGENT created through `coord_write_prompt_document` — coord's
 *   `AGENT_UNWRITABLE_DOCUMENTS` protects the three canonical `(kind, name)`
 *   pairs, so every other briefing name is agent-writable by default.
 *
 * For both, the list is the only place an operator ever meets the row, and it
 * sits under a heading that says this kind becomes the system prompt of every
 * session the fleet hosts. So the list has to say which briefings are live —
 * without cluttering the three that are.
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
  isInertSessionBriefing,
  SESSION_BRIEFING_DOCUMENT_NAMES,
} from "../types";

function summary(
  kind: PromptDocumentKind,
  name: string
): PromptDocumentSummary {
  return {
    id: `doc-${name}`,
    tenant_id: "tenant-1",
    kind,
    name,
    description: null,
    format: "markdown",
    default_source: "prompt_doc/x/y/v1",
    current_version: 2,
    updated_by: "someone@example.com",
    updated_at: "2026-08-20T10:00:00Z",
    attrs: null,
  };
}

function renderList(documents: PromptDocumentSummary[]) {
  getMock.mockResolvedValue({ documents, degraded: null });
  render(<PromptDocumentList />);
}

beforeEach(() => {
  getMock.mockReset();
});

describe("prompt-document list — inert session briefings", () => {
  it("flags a briefing under a name the runner does not resolve", async () => {
    renderList([summary("session_briefing", "fleet-rules")]);
    const row = await screen.findByTestId(
      "doc-row-session_briefing-fleet-rules"
    );
    const badge = within(row).getByTestId(
      "doc-inert-session_briefing-fleet-rules"
    );
    expect(badge).toHaveTextContent("Inert");
    // The badge is the summary; the reason has to be readable without leaving
    // the page, and it is the second property — agent-writable by default —
    // that an operator would otherwise never learn.
    expect(badge.getAttribute("title")).toContain("never lists this kind");
    expect(badge.getAttribute("title")).toContain("agent-writable");
  });

  it("leaves the three canonical briefings unmarked", async () => {
    renderList(
      SESSION_BRIEFING_DOCUMENT_NAMES.map((n) => summary("session_briefing", n))
    );
    for (const name of SESSION_BRIEFING_DOCUMENT_NAMES) {
      const row = await screen.findByTestId(`doc-row-session_briefing-${name}`);
      expect(
        within(row).queryByTestId(`doc-inert-session_briefing-${name}`)
      ).not.toBeInTheDocument();
    }
  });

  /**
   * The predicate keys on the kind as well as the name. A `policy` named
   * `fleet-rules` is not an inert briefing, and marking one would be a false
   * warning on the kind that carries the fleet's actual rules.
   */
  it("does not flag another kind that happens to share the name", async () => {
    renderList([summary("policy", "fleet-rules")]);
    const row = await screen.findByTestId("doc-row-policy-fleet-rules");
    expect(
      within(row).queryByTestId("doc-inert-policy-fleet-rules")
    ).not.toBeInTheDocument();
  });
});

describe("isInertSessionBriefing", () => {
  it("is false for each name the runner resolves", () => {
    for (const name of SESSION_BRIEFING_DOCUMENT_NAMES) {
      expect(isInertSessionBriefing("session_briefing", name)).toBe(false);
    }
  });

  it("is true for any other briefing name", () => {
    expect(isInertSessionBriefing("session_briefing", "runner-sessions")).toBe(
      true
    );
    expect(isInertSessionBriefing("session_briefing", "")).toBe(true);
  });

  it("binds only the session_briefing kind", () => {
    expect(isInertSessionBriefing("policy", "anything-at-all")).toBe(false);
    expect(isInertSessionBriefing("prompt_template", "runner-session")).toBe(
      false
    );
  });

  /**
   * The create dialog feeds this a live input value, so a trailing space is a
   * normal keystroke rather than a stored name — trimming there and not here
   * would warn an operator that a canonical name is inert mid-type.
   */
  it("trims the name it is given", () => {
    expect(isInertSessionBriefing("session_briefing", " runner-session ")).toBe(
      false
    );
  });
});
