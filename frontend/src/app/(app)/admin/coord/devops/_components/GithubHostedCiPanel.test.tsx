/**
 * GithubHostedCiPanel — plan
 * `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting` Phase 3.
 *
 * Drives the REAL hooks against a mocked `httpClient`, so the wire bodies the
 * panel sends (the off-confirm's change note, the inherit write's repo band)
 * are asserted where they are built rather than through a hook stub.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const httpGet = vi.fn();
const httpPut = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    put: (...args: unknown[]) => httpPut(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import { GithubHostedCiPanel } from "./GithubHostedCiPanel";

function tenantPolicy(
  level: string,
  scope: string,
  canEdit = true
): Record<string, unknown> {
  return {
    domain: "github_hosted_ci",
    effective_level: level,
    master_enabled: true,
    resolved_scope: scope,
    can_edit: canEdit,
    keys_not_shown: [],
    keys_not_shown_source: null,
  };
}

const CI_VIEW = {
  domain: "github_hosted_ci",
  tenant_default: { level: "on", resolved_scope: "none", unknown_reason: null },
  repos: [
    {
      repo: "qontinui/qontinui-web",
      level: "off",
      resolved_scope: "repo",
      unknown_reason: null,
    },
    {
      repo: "qontinui/multistate",
      level: "on",
      resolved_scope: "none",
      unknown_reason: null,
    },
    {
      repo: "qontinui/shared",
      level: null,
      resolved_scope: "none",
      unknown_reason: "owners_disagree",
    },
    {
      repo: "qontinui/broken",
      level: null,
      resolved_scope: "none",
      unknown_reason: "select_failed",
    },
  ],
  can_edit: true,
};

function route(opts: {
  tenant?: Record<string, unknown> | Error;
  ci?: Record<string, unknown> | Error;
}) {
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/fleet-policy")) {
      const t = opts.tenant ?? tenantPolicy("on", "none");
      return t instanceof Error ? Promise.reject(t) : Promise.resolve(t);
    }
    if (u.includes("/ci-hosting")) {
      const c = opts.ci ?? CI_VIEW;
      return c instanceof Error ? Promise.reject(c) : Promise.resolve(c);
    }
    return Promise.reject(new Error(`unexpected GET ${u}`));
  });
}

function rowFor(repo: string): HTMLElement {
  const row = screen
    .getAllByTestId("github-hosted-ci-repo-row")
    .find((el) => el.getAttribute("data-row-key") === repo);
  if (!row) throw new Error(`no row for ${repo}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage — the panel defaults open either way.
  }
});

describe("GithubHostedCiPanel — tenant row", () => {
  it("renders the tenant value and names a no-row source as the default", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);

    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-effective")
      ).toHaveTextContent("On")
    );
    expect(
      screen.getByTestId("github-hosted-ci-tenant-source")
    ).toHaveTextContent("default (on)");
  });

  it("renders an explicit tenant OFF as a setting from the tenant", async () => {
    route({ tenant: tenantPolicy("off", "tenant") });
    render(<GithubHostedCiPanel isAdmin />);

    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-effective")
      ).toHaveTextContent("Off")
    );
    expect(
      screen.getByTestId("github-hosted-ci-tenant-source")
    ).toHaveTextContent("tenant setting");
    // A setting in effect is not an alarm (§3.4): no amber on the value.
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective").className
    ).not.toMatch(/amber/);
  });

  it("turning OFF requires a confirm with a reason, which becomes the change note", async () => {
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "off",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: "op",
      effective: tenantPolicy("off", "tenant"),
      readback_error: null,
    });
    render(<GithubHostedCiPanel isAdmin />);
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-off")
      ).not.toBeDisabled()
    );

    fireEvent.click(screen.getByTestId("github-hosted-ci-tenant-off"));
    // Nothing is written by the click alone.
    expect(httpPut).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId("github-hosted-ci-off-dialog");
    expect(dialog).toHaveTextContent(/treated\s+as mis-targeted/);
    expect(dialog).toHaveTextContent(/self-hosted runners/);

    // The submit is refused until a reason is typed — whitespace is no reason.
    const submit = screen.getByTestId("github-hosted-ci-off-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("github-hosted-ci-off-reason"), {
      target: { value: "   " },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("github-hosted-ci-off-reason"), {
      target: { value: "  cost: all CI is self-hosted  " },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(httpPut).toHaveBeenCalledTimes(1));
    expect(httpPut).toHaveBeenCalledWith("/api/v1/operations/fleet-policy", {
      domain: "github_hosted_ci",
      scope_band: "tenant",
      scope_key: null,
      level: "off",
      master_enabled: true,
      change_note: "cost: all CI is self-hosted",
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-effective")
      ).toHaveTextContent("Off")
    );
  });

  it("turning ON writes without a dialog", async () => {
    route({ tenant: tenantPolicy("off", "tenant") });
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "on",
      effective: tenantPolicy("on", "tenant"),
      readback_error: null,
    });
    render(<GithubHostedCiPanel isAdmin />);
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-on")
      ).not.toBeDisabled()
    );
    fireEvent.click(screen.getByTestId("github-hosted-ci-tenant-on"));
    await waitFor(() => expect(httpPut).toHaveBeenCalledTimes(1));
    expect(httpPut.mock.calls[0]?.[1]).toMatchObject({
      scope_band: "tenant",
      level: "on",
      master_enabled: true,
    });
    expect(screen.queryByTestId("github-hosted-ci-off-dialog")).toBeNull();
  });
});

describe("GithubHostedCiPanel — repo rows", () => {
  it("shows each repo's effective value and where it comes from", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    const web = rowFor("qontinui/qontinui-web");
    expect(within(web).getByText("Off")).toBeInTheDocument();
    expect(web).toHaveTextContent("from repo override");
    // Off is a setting, not an alarm: no accent.
    expect(
      web.querySelector("[data-console-row]")?.getAttribute("data-attention")
    ).toBe("none");

    expect(rowFor("qontinui/multistate")).toHaveTextContent("from default");
  });

  it("renders owners disagree in amber", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    const shared = rowFor("qontinui/shared");
    const badge = shared.querySelector("[data-status-kind]");
    expect(badge?.getAttribute("data-status-kind")).toBe("owners_disagree");
    expect(badge).toHaveTextContent("owners disagree");
    expect(badge?.className).toMatch(/amber/);
  });

  it("renders an UNKNOWN repo as an amber dash, never a guessed value", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    const broken = rowFor("qontinui/broken");
    const badge = broken.querySelector("[data-status-kind]");
    expect(badge?.getAttribute("data-status-kind")).toBe("unknown");
    expect(badge?.textContent).toBe("–");
    expect(badge?.className).toMatch(/amber/);
    expect(broken).not.toHaveTextContent(/\bOn\b/);
    expect(
      broken.querySelector("[data-console-row]")?.getAttribute("data-attention")
    ).toBe("waiting");
  });

  it("Inherit writes the repo band with the owner/name key and master_enabled true", async () => {
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "inherit",
      effective: tenantPolicy("on", "none"),
      readback_error: null,
    });
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    const web = rowFor("qontinui/qontinui-web");
    fireEvent.click(within(web).getByRole("button", { expanded: false }));
    fireEvent.click(within(web).getByTestId("github-hosted-ci-repo-inherit"));

    await waitFor(() => expect(httpPut).toHaveBeenCalledTimes(1));
    const [url, body] = httpPut.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe("/api/v1/operations/fleet-policy");
    expect(body).toMatchObject({
      domain: "github_hosted_ci",
      scope_band: "repo",
      scope_key: "qontinui/qontinui-web",
      level: "inherit",
      master_enabled: true,
    });
    // A confirmed write re-reads what every repo resolves.
    await waitFor(() =>
      expect(
        httpGet.mock.calls.filter((c) => String(c[0]).includes("/ci-hosting"))
          .length
      ).toBeGreaterThanOrEqual(2)
    );
  });

  it("a failed read-back renders that repo UNKNOWN, not the written value", async () => {
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "on",
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    const web = rowFor("qontinui/qontinui-web");
    fireEvent.click(within(web).getByRole("button", { expanded: false }));
    fireEvent.click(within(web).getByTestId("github-hosted-ci-repo-on"));

    await waitFor(() =>
      expect(
        rowFor("qontinui/qontinui-web")
          .querySelector("[data-status-kind]")
          ?.getAttribute("data-status-kind")
      ).toBe("unknown")
    );
  });
});

describe("GithubHostedCiPanel — read-only and read failures", () => {
  it("is read-only for a non-admin of the active tenant", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin={false} />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    expect(screen.getByTestId("github-hosted-ci-tenant-on")).toBeDisabled();
    expect(screen.getByTestId("github-hosted-ci-tenant-off")).toBeDisabled();
    expect(screen.getByTestId("github-hosted-ci-readonly")).toHaveTextContent(
      /only an admin/
    );
    const web = rowFor("qontinui/qontinui-web");
    fireEvent.click(within(web).getByRole("button", { expanded: false }));
    for (const choice of ["inherit", "on", "off"]) {
      expect(
        within(web).getByTestId(`github-hosted-ci-repo-${choice}`)
      ).toBeDisabled();
    }
  });

  it("is read-only when the backend says can_edit false, even for an admin", async () => {
    route({
      tenant: tenantPolicy("on", "none", false),
      ci: { ...CI_VIEW, can_edit: false },
    });
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");
    expect(screen.getByTestId("github-hosted-ci-tenant-off")).toBeDisabled();
  });

  it("a coord without the route (404) renders UNKNOWN, never a value", async () => {
    route({
      ci: new Error(
        'GET /api/v1/operations/ci-hosting failed: 404 - {"detail":"Not Found"}'
      ),
    });
    render(<GithubHostedCiPanel isAdmin />);

    const banner = await screen.findByTestId("github-hosted-ci-repos-error");
    expect(banner).toHaveTextContent(
      "this coord build does not serve the hosted-CI read yet"
    );
    expect(screen.queryAllByTestId("github-hosted-ci-repo-row")).toHaveLength(
      0
    );
    expect(
      screen.getByTestId("github-hosted-ci-summary-repos")
    ).toHaveTextContent("repos –");
  });

  it("a failed tenant read renders the tenant value as a dash", async () => {
    route({
      tenant: new Error(
        "GET /api/v1/operations/fleet-policy failed: 502 - coord is not reachable"
      ),
    });
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findByTestId("github-hosted-ci-tenant-error");
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective").textContent
    ).toBe("–");
  });

  it("a failed LATEST read keeps the last values, labelled stale", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    route({
      ci: new Error(
        "GET /api/v1/operations/ci-hosting failed: 502 - coord is not reachable"
      ),
    });
    fireEvent.click(screen.getByTestId("github-hosted-ci-refresh"));

    const banner = await screen.findByTestId("github-hosted-ci-repos-error");
    expect(banner).toHaveTextContent(/last values read, which may be stale/);
    const web = rowFor("qontinui/qontinui-web");
    // Still the retained value…
    expect(within(web).getByText("Off")).toBeInTheDocument();
    // …but labelled, and no longer calm.
    expect(web).toHaveTextContent(/may be stale/);
    expect(
      web.querySelector("[data-console-row]")?.getAttribute("data-attention")
    ).toBe("waiting");
  });
});
