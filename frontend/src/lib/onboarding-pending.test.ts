/**
 * The four readings of a pending-installation response must stay apart — and
 * the fourth (`pending: null`, the table is ABSENT) must never collapse into
 * "not installed". That is the one an operator would act on wrongly: they
 * would go install an App that is already installed.
 */

import { describe, expect, it, vi } from "vitest";
import { absoluteTime } from "@/components/console/time";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    get: vi.fn(),
  },
}));

import {
  classifyPendingInstallation,
  describePendingInstallation,
  describePendingInstallationFailure,
  fetchPendingInstallation,
  formatRepoCount,
  type PendingInstallationResponse,
} from "./onboarding-pending";

const RECEIVED = "2026-09-05T10:11:12Z";
const CLAIMED = "2026-09-05T12:00:00Z";

const PENDING: PendingInstallationResponse = {
  pending: true,
  installation_id: 143833618,
  account_login: "portofino-pizzeria",
  account_type: "Organization",
  repo_count: 3,
  received_at: RECEIVED,
  claimed_at: null,
};

const NO_ROW: PendingInstallationResponse = {
  pending: false,
  installation_id: null,
  account_login: null,
  account_type: null,
  repo_count: null,
  received_at: null,
  claimed_at: null,
};

const UNKNOWN: PendingInstallationResponse = {
  ...NO_ROW,
  pending: null,
  reason: "pending_installations_table_absent",
};

describe("classifyPendingInstallation", () => {
  it("keeps the four readings apart", () => {
    expect(classifyPendingInstallation(PENDING)).toBe("pending");
    expect(
      classifyPendingInstallation({ ...PENDING, pending: false, claimed_at: CLAIMED })
    ).toBe("claimed");
    expect(classifyPendingInstallation(NO_ROW)).toBe("unseen");
    expect(classifyPendingInstallation(UNKNOWN)).toBe("unknown");
  });

  it("reads a malformed envelope as UNKNOWN, never as a confident negative", () => {
    expect(classifyPendingInstallation(undefined)).toBe("unknown");
    expect(classifyPendingInstallation(null)).toBe("unknown");
    expect(classifyPendingInstallation("nope")).toBe("unknown");
    expect(classifyPendingInstallation({ ok: true })).toBe("unknown");
    // A string `pending` is not a boolean — coord's contract is bool|null.
    expect(classifyPendingInstallation({ pending: "false" })).toBe("unknown");
  });
});

describe("describePendingInstallation", () => {
  it("pending: names the org, the repo count and the localized time, and says connect", () => {
    const v = describePendingInstallation(PENDING, "typed-org");
    expect(v.kind).toBe("pending");
    expect(v.message).toBe(
      `coord saw the App installed on portofino-pizzeria (3 repos) at ${absoluteTime(RECEIVED)} — not connected to a tenant yet. Connect it.`
    );
  });

  it("claimed: says when it was connected", () => {
    const v = describePendingInstallation(
      { ...PENDING, pending: false, claimed_at: CLAIMED },
      "typed-org"
    );
    expect(v.kind).toBe("claimed");
    expect(v.message).toBe(
      `portofino-pizzeria was already connected on ${absoluteTime(CLAIMED)}.`
    );
  });

  it("unseen: falls back to the typed subject and points at the install", () => {
    const v = describePendingInstallation(NO_ROW, "typed-org");
    expect(v.kind).toBe("unseen");
    expect(v.message).toBe(
      "coord has not seen an install for typed-org; install the App first."
    );
  });

  it("unknown: says it could not check — and does NOT say 'not installed'", () => {
    const v = describePendingInstallation(UNKNOWN, "typed-org");
    expect(v.kind).toBe("unknown");
    expect(v.message).toMatch(/couldn't check with coord/);
    expect(v.message).toMatch(/table unavailable/);
    expect(v.message).not.toMatch(/not seen|install the App/);
  });

  it("prefers coord's canonical login over what was typed", () => {
    const v = describePendingInstallation(PENDING, "PORTOFINO-PIZZERIA");
    expect(v.message).toContain("on portofino-pizzeria (");
  });
});

describe("formatRepoCount", () => {
  it("pluralises and treats null as unknown, not zero", () => {
    expect(formatRepoCount(1)).toBe("1 repo");
    expect(formatRepoCount(3)).toBe("3 repos");
    expect(formatRepoCount(0)).toBe("0 repos");
    expect(formatRepoCount(null)).toBe("an unknown number of repos");
  });
});

describe("describePendingInstallationFailure", () => {
  it("is the UNKNOWN arm carrying the failure detail", () => {
    const v = describePendingInstallationFailure(new Error("HTTP 502"));
    expect(v.kind).toBe("unknown");
    expect(v.message).toBe("couldn't check with coord (HTTP 502)");
  });
});

describe("fetchPendingInstallation", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("sends exactly one key under coord's own query-param name", async () => {
    fetchMock.mockReset();
    // A fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(PENDING)));

    await fetchPendingInstallation({ account_login: "portofino-pizzeria" });
    let url = new URL(String(fetchMock.mock.calls[0][0]), "https://x.test");
    expect(url.pathname).toMatch(/\/pr-merge\/onboarding\/pending-installation$/);
    expect(url.searchParams.get("account_login")).toBe("portofino-pizzeria");
    expect(url.searchParams.has("installation_id")).toBe(false);

    await fetchPendingInstallation({ installation_id: 143833618 });
    url = new URL(String(fetchMock.mock.calls[1][0]), "https://x.test");
    expect(url.searchParams.get("installation_id")).toBe("143833618");
    expect(url.searchParams.has("account_login")).toBe(false);
  });

  it("throws on a non-2xx, naming the status, so callers fold it into UNKNOWN", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ detail: "coord is not reachable" }, 502));
    await expect(
      fetchPendingInstallation({ account_login: "acme" })
    ).rejects.toThrow(/HTTP 502/);
  });
});
