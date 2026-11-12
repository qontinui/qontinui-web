/**
 * The prompt-documents PAGE's settings after another tab switches project,
 * reached past the page's disabled fieldset: a confirmation renders outside
 * it, and a click can land before the other tab's `storage` event does.
 *
 * Renders the real page with the real settings controls (`httpClient.fetch`
 * is faked per URL). Each test opens the control's confirmation — or, for the
 * compliance settings, which have none, readies the save — while this page's
 * project is stored, then another tab stores a different one (its event not
 * yet arrived), then confirms. Nothing may be sent: the page's call-time
 * guard, which the list hands up, refuses the write and raises the notice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Sent = { method: string; url: string };
let sent: Sent[] = [];

function view(domain: string, level: string) {
  return {
    domain,
    effective_level: level,
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
  };
}

function answer(url: string): unknown {
  if (url.includes("/auto-publish/status")) {
    return { candidates: [], count: 0, publishing_enabled: true };
  }
  if (url.includes("/fleet-policy")) {
    const domain = new URL(url, "http://x").searchParams.get("domain") ?? "";
    const level =
      domain === "policy_write"
        ? "tightening_only"
        : domain === "policy_upstream"
          ? "notify"
          : "off";
    return view(domain, level);
  }
  if (url.includes("/prompt-document-kind-tiers")) {
    return {
      kinds: [
        {
          kind: "audience_profile",
          tier: null,
          unreadable: false,
          builtin_default_tier: "deny",
          effective_tier: "deny",
          effective_source: "default",
        },
      ],
      vocabulary: ["deny", "allow", "allow_with_notification"],
      notification_enforced: false,
      warning: "x",
    };
  }
  if (url.includes("/session-compliance/config/versions")) {
    return { versions: [] };
  }
  if (url.includes("/session-compliance/config")) {
    return {
      enabled: true,
      mode: "nudge",
      max_attempts: 1,
      enforced_clause_ref: "policy/planning-and-scope#finish-to-zero",
      applicable: true,
      applicability_reason: "applicable",
      clause_resolved_via: "registry",
      prompt_document_version: 7,
      current_version: 3,
    };
  }
  if (url.includes("/session-compliance/sessions")) return { sessions: [] };
  if (url.includes("/session-compliance/outstanding")) return { items: [] };
  if (/\/coord\/prompt-documents(\?|$)/.test(url)) {
    return { documents: [], degraded: null };
  }
  return null;
}

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init: { method?: string } = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      sent.push({ method, url });
      // Every write answers as accepted: the tests assert it was not SENT.
      return new Response(
        JSON.stringify(method === "GET" ? answer(url) : { ok: true })
      );
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import PromptDocumentsPage from "../page";

const KEY = "qontinui.active_tenant_id";
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  sent = [];
  localStorage.clear();
  localStorage.setItem(KEY, "t-bravo");
});
afterEach(() => {
  localStorage.clear();
});

/** Another tab stores a different project; its event has not arrived. */
const anotherTabStoresSilently = () => localStorage.setItem(KEY, "t-system");
const writesSince = (from: number) =>
  sent.slice(from).filter((s) => s.method !== "GET");

async function expectRefused(before: number) {
  expect(
    await screen.findByTestId("prompt-documents-cross-tab")
  ).toBeInTheDocument();
  expect(writesSince(before)).toEqual([]);
}

function radio(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id}`);
  return el;
}

describe("a settings write raced past the page's fieldset is refused", () => {
  it("the policy-write dial's 'full' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId("policy-write-dial", {}, { timeout: 5000 });
    await user().click(radio("policy-write-full"));
    await screen.findByTestId("policy-write-confirm");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(screen.getByRole("button", { name: /set to full/i }));

    await expectRefused(before);
  });

  it("the upstream dial's 'auto' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId("policy-upstream-dial", {}, { timeout: 5000 });
    await user().click(radio("policy-upstream-auto"));
    await screen.findByTestId("policy-upstream-confirm");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(screen.getByRole("button", { name: /set to auto/i }));

    await expectRefused(before);
  });

  it("the auto-publish dial's 'on' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await user().click(
      await screen.findByTestId(
        "policy-auto-publish-level-on",
        {},
        { timeout: 5000 }
      )
    );
    await screen.findByTestId("policy-auto-publish-confirm");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(
      screen.getByTestId("policy-auto-publish-confirm-accept")
    );

    await expectRefused(before);
  });

  it("the kind-tier 'Open the kind' confirmation sends nothing", async () => {
    render(<PromptDocumentsPage />);
    await screen.findByTestId(
      "kind-tier-row-audience_profile",
      {},
      { timeout: 5000 }
    );
    await user().click(screen.getByRole("button", { name: "allow" }));
    const open = await screen.findByRole("button", { name: /Open the kind/i });
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(open);

    await expectRefused(before);
  });

  it("the session-compliance save sends nothing", async () => {
    render(<PromptDocumentsPage />);
    const attempts = await screen.findByTestId(
      "compliance-max-attempts",
      {},
      { timeout: 5000 }
    );
    await user().clear(attempts);
    await user().type(attempts, "2");
    anotherTabStoresSilently();
    const before = sent.length;

    await user().click(screen.getByTestId("compliance-save"));

    await expectRefused(before);
  });
});
