/**
 * The prompt-documents PAGE shares one auto-publish status read between the
 * list and the dial, and re-takes it after the dial's level changes.
 *
 * Plan `2026-10-17-auto-publish-lands-via-coord-2290-adoption` Phase 4. Renders
 * the real `PromptDocumentsPage` — the real list and the real dial, wired by
 * `page.tsx` itself — so this fails if the page goes back to a second fetch or
 * stops reloading after a write. The four unrelated sections on the page are
 * stubbed: they read their own doors and are not under test here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";
import type { AutoPublishStatusResponse } from "../types";

const statusGet = vi.fn();
const policyGet = vi.fn();
const otherGet = vi.fn();
const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method ?? "GET";
      let out: unknown;
      if (method === "PUT") {
        out = await putMock(url, JSON.parse(init.body ?? "null"));
      } else if (method !== "GET") {
        throw new Error(`fetch mock: unexpected ${method} ${url}`);
      } else if (url.includes("/auto-publish/status")) {
        out = await statusGet(url);
      } else if (url.includes("/fleet-policy")) {
        out = await policyGet(url);
      } else {
        out = await otherGet(url);
      }
      return out instanceof Response
        ? out
        : new Response(JSON.stringify(out ?? null));
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("./KindAuthorshipTierControl", () => ({
  KindAuthorshipTierControl: () => null,
}));
vi.mock("./PolicyWriteDialControl", () => ({
  PolicyWriteDialControl: () => null,
}));
vi.mock("./PolicyUpstreamDialControl", () => ({
  PolicyUpstreamDialControl: () => null,
}));
vi.mock("./SessionComplianceSection", () => ({
  SessionComplianceSection: () => null,
}));

import PromptDocumentsPage from "../page";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function view(over: Partial<FleetPolicyView> = {}): FleetPolicyView {
  return {
    domain: "policy_auto_publish",
    effective_level: "on",
    master_enabled: true,
    resolved_scope: "tenant",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
    ...over,
  };
}

function aliveStatus(code: string): AutoPublishStatusResponse {
  return {
    candidates: [],
    count: 0,
    publishing_enabled: true,
    worker: {
      pass: {
        status: "alive",
        last_tick_at: new Date().toISOString(),
        last_work_tick_at: new Date(Date.now() - 3 * 60_000).toISOString(),
        last_decision_code: code,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  policyGet.mockResolvedValue(view());
  // The document list and anything else the list reads: an empty corpus.
  otherGet.mockResolvedValue({ documents: [], degraded: null });
});

describe("the page's one auto-publish status read", () => {
  it("is fetched once on mount and re-taken once after the dial's level changes", async () => {
    statusGet.mockResolvedValueOnce(aliveStatus("ran:published"));
    render(<PromptDocumentsPage />);

    const line = await screen.findByTestId("policy-auto-publish-observed");
    expect(line).toHaveTextContent(
      "Observed: last pass 3m ago — ran:published"
    );
    // The list and the dial both consume it, and it was read ONCE.
    expect(statusGet).toHaveBeenCalledTimes(1);

    statusGet.mockResolvedValueOnce(aliveStatus("skip:switch_off"));
    putMock.mockResolvedValue({
      ok: true,
      domain: "policy_auto_publish",
      written_level: "off",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "operator@example.com",
      effective: view({ effective_level: "off" }),
      readback_error: null,
    });
    // `off` applies on one click (no confirmation), then fires onLevelChanged.
    await user().click(screen.getByTestId("policy-auto-publish-level-off"));

    await waitFor(() =>
      expect(
        screen.getByTestId("policy-auto-publish-observed")
      ).toHaveTextContent("skip:switch_off")
    );
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(statusGet).toHaveBeenCalledTimes(2);
  });
});
