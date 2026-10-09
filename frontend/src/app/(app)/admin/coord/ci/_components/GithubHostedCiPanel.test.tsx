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
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const httpGet = vi.fn();
const httpPut = vi.fn();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    put: (...args: unknown[]) => httpPut(...args),
    // The typed /operations client reads over `httpClient.fetch` (plan
    // 2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls
    // Phase 7): route it through the same GET table. A rejection passes
    // through unchanged, so error-path tests see the identical Error.
    fetch: async (...a: unknown[]) =>
      new Response(JSON.stringify(await httpGet(...a)), { status: 200 }),
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

function ciView(
  tenantLevel: string | null,
  tenantScope: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...CI_VIEW,
    tenant_default: {
      level: tenantLevel,
      resolved_scope: tenantScope,
      unknown_reason: tenantLevel === null ? "select_failed" : null,
    },
    ...extra,
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
      repo: "qontinui/elsewhere",
      level: null,
      resolved_scope: "none",
      unknown_reason: "repo_not_in_tenant",
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

  it("displays the AGGREGATE's tenant value, not the generic dial's", async () => {
    // The dial's generic view would say `off` (it floors a missing level);
    // the aggregate says UNKNOWN, and the aggregate is what is shown.
    route({
      tenant: tenantPolicy("off", "tenant"),
      ci: ciView(null, "none"),
    });
    render(<GithubHostedCiPanel isAdmin />);

    const unknown = await screen.findByTestId(
      "github-hosted-ci-tenant-unknown"
    );
    expect(unknown).toHaveTextContent(/select_failed/);
    const value = screen.getByTestId("github-hosted-ci-tenant-effective");
    expect(value.textContent).toBe("–");
    expect(value.className).toMatch(/amber/);
  });

  it("renders an explicit tenant OFF as a setting from the tenant", async () => {
    route({
      tenant: tenantPolicy("off", "tenant"),
      ci: ciView("off", "tenant"),
    });
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
    const r: { ci: Record<string, unknown> } = { ci: CI_VIEW };
    route(r);
    httpPut.mockImplementation(() => {
      // Coord now resolves off — the next aggregate read says so.
      r.ci = ciView("off", "tenant");
      return Promise.resolve({
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
    // Confirmed only once an aggregate read made AFTER the write agrees.
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-effective")
      ).toHaveTextContent("Off")
    );
    expect(screen.queryByTestId("github-hosted-ci-tenant-awaiting")).toBeNull();
  });

  it("shows UNKNOWN when the write's read-back and a later aggregate read disagree", async () => {
    // The aggregate keeps saying `on` after a write whose read-back said `off`.
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "off",
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
    fireEvent.change(await screen.findByTestId("github-hosted-ci-off-reason"), {
      target: { value: "cost" },
    });
    fireEvent.click(screen.getByTestId("github-hosted-ci-off-submit"));

    const awaiting = await screen.findByTestId(
      "github-hosted-ci-tenant-awaiting"
    );
    await waitFor(() => expect(awaiting).toHaveTextContent(/disagree/));
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective").textContent
    ).toBe("–");
  });

  it("a failed tenant read-back renders the tenant value UNKNOWN", async () => {
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "off",
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    render(<GithubHostedCiPanel isAdmin />);
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-off")
      ).not.toBeDisabled()
    );
    fireEvent.click(screen.getByTestId("github-hosted-ci-tenant-off"));
    fireEvent.change(await screen.findByTestId("github-hosted-ci-off-reason"), {
      target: { value: "cost" },
    });
    fireEvent.click(screen.getByTestId("github-hosted-ci-off-submit"));

    const notice = await screen.findByTestId(
      "github-hosted-ci-tenant-readback-error"
    );
    expect(notice).toHaveTextContent(/coord returned 502/);
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective").textContent
    ).toBe("–");
    expect(
      screen.getByTestId("github-hosted-ci-summary-tenant")
    ).toHaveTextContent("tenant –");
  });

  it("turning ON writes without a dialog", async () => {
    route({
      tenant: tenantPolicy("off", "tenant"),
      ci: ciView("off", "tenant"),
    });
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

  it("has no owners-disagree state; a repo outside the tenant is a typed UNKNOWN", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    expect(screen.queryByText(/owners disagree/)).toBeNull();
    const elsewhere = rowFor("qontinui/elsewhere");
    const badge = elsewhere.querySelector("[data-status-kind]");
    expect(badge?.getAttribute("data-status-kind")).toBe("unknown");
    expect(badge?.textContent).toBe("–");
    expect(elsewhere).toHaveTextContent(/not one of this tenant's repos/);
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

  it("renders `not watched` only for an off repo coord says it does not poll", async () => {
    route({
      ci: {
        ...CI_VIEW,
        repos: [
          {
            repo: "o/unwatched",
            level: "off",
            resolved_scope: "repo",
            unknown_reason: null,
            watched: false,
          },
          {
            repo: "o/older-coord",
            level: "off",
            resolved_scope: "repo",
            unknown_reason: null,
          },
          {
            repo: "o/null",
            level: "off",
            resolved_scope: "repo",
            unknown_reason: null,
            watched: null,
          },
          {
            repo: "o/on",
            level: "on",
            resolved_scope: "repo",
            unknown_reason: null,
            watched: false,
          },
        ],
      },
    });
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");

    const unwatched = rowFor("o/unwatched");
    const tag = within(unwatched).getByTestId("github-hosted-ci-not-watched");
    expect(tag.className).toMatch(/amber/);
    expect(
      unwatched
        .querySelector("[data-console-row]")
        ?.getAttribute("data-attention")
    ).toBe("waiting");
    for (const repo of ["o/older-coord", "o/null", "o/on"]) {
      expect(
        within(rowFor(repo)).queryByTestId("github-hosted-ci-not-watched")
      ).toBeNull();
    }
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

  it("a failed read-back renders THAT repo UNKNOWN, leaves the others, and highlights no choice", async () => {
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
    const after = rowFor("qontinui/qontinui-web");
    expect(after).toHaveTextContent(/reading it back failed/);
    // No choice is shown as in force — the written one is unconfirmed.
    for (const choice of ["inherit", "on", "off"]) {
      expect(
        within(after).getByTestId(`github-hosted-ci-repo-${choice}`)
      ).not.toBeDisabled();
    }
    // The guard is per repo: a neighbour keeps its confirmed value.
    expect(
      rowFor("qontinui/multistate")
        .querySelector("[data-status-kind]")
        ?.getAttribute("data-status-kind")
    ).toBe("on");
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

  it("says nothing about the role while the first reads are in flight", async () => {
    const tenantRead = deferred<unknown>();
    const ciRead = deferred<unknown>();
    httpGet.mockImplementation((url: unknown) =>
      String(url).includes("/fleet-policy")
        ? tenantRead.promise
        : ciRead.promise
    );
    render(<GithubHostedCiPanel isAdmin={false} />);
    expect(screen.queryByTestId("github-hosted-ci-readonly")).toBeNull();

    tenantRead.resolve(tenantPolicy("on", "none", false));
    ciRead.resolve(CI_VIEW);
    expect(
      await screen.findByTestId("github-hosted-ci-readonly")
    ).toHaveTextContent(/only an admin/);
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
    // The tenant value comes from the same read, so it is unknown too.
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective").textContent
    ).toBe("–");
  });

  it("a failed tenant-dial read does not blank the tenant value the aggregate gave", async () => {
    route({
      tenant: new Error(
        "GET /api/v1/operations/fleet-policy failed: 502 - coord is not reachable"
      ),
    });
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findByTestId("github-hosted-ci-tenant-error");
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-effective")
      ).toHaveTextContent("On")
    );
    // But nobody may write: whether the caller can is unknown.
    expect(screen.getByTestId("github-hosted-ci-tenant-off")).toBeDisabled();
  });

  it("a failed LATEST read keeps the last values, labelled stale — in the header too", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");
    expect(
      screen.getByTestId("github-hosted-ci-summary-repos")
    ).not.toHaveTextContent(/stale/);

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
    // The collapsed header says so as well (R6/R7).
    for (const id of [
      "github-hosted-ci-summary-tenant",
      "github-hosted-ci-summary-repos",
    ]) {
      const badge = screen.getByTestId(id);
      expect(badge).toHaveTextContent(/\(stale\)/);
      expect(badge.className).toMatch(/amber/);
    }
  });

  it("a failed TENANT-dial read does not mark the aggregate-sourced header stale", async () => {
    route({});
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-off")
      ).not.toBeDisabled()
    );

    route({
      tenant: new Error(
        "GET /api/v1/operations/fleet-policy failed: 502 - coord is not reachable"
      ),
    });
    fireEvent.click(screen.getByTestId("github-hosted-ci-refresh"));

    await screen.findByTestId("github-hosted-ci-tenant-error");
    // Both badges come from the aggregate, which just re-confirmed.
    for (const id of [
      "github-hosted-ci-summary-tenant",
      "github-hosted-ci-summary-repos",
    ]) {
      const badge = screen.getByTestId(id);
      expect(badge).not.toHaveTextContent(/stale/);
    }
    expect(
      screen.getByTestId("github-hosted-ci-summary-tenant").className
    ).not.toMatch(/amber/);
  });

  it("an admin whose tenant-dial read failed is told the role could not be read", async () => {
    route({
      tenant: new Error(
        "GET /api/v1/operations/fleet-policy failed: 502 - coord is not reachable"
      ),
    });
    render(<GithubHostedCiPanel isAdmin />);
    const text = await screen.findByTestId("github-hosted-ci-readonly");
    expect(text).toHaveTextContent(/your role could not be read/);
    expect(text).not.toHaveTextContent(/only an admin/);
  });
});

/** A `/ci-hosting` GET whose answer the test hands out one at a time. */
function routeQueuedCi(opts: { tenant?: Record<string, unknown> } = {}) {
  const pending: ReturnType<typeof deferred<unknown>>[] = [];
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/fleet-policy")) {
      return Promise.resolve(opts.tenant ?? tenantPolicy("on", "none"));
    }
    if (u.includes("/ci-hosting")) {
      const d = deferred<unknown>();
      pending.push(d);
      return d.promise;
    }
    return Promise.reject(new Error(`unexpected GET ${u}`));
  });
  return pending;
}

async function writeTenantOff() {
  await waitFor(() =>
    expect(screen.getByTestId("github-hosted-ci-tenant-off")).not.toBeDisabled()
  );
  fireEvent.click(screen.getByTestId("github-hosted-ci-tenant-off"));
  fireEvent.change(await screen.findByTestId("github-hosted-ci-off-reason"), {
    target: { value: "cost" },
  });
  fireEvent.click(screen.getByTestId("github-hosted-ci-off-submit"));
}

describe("GithubHostedCiPanel — only a read ISSUED after a write confirms it", () => {
  it("a matching aggregate delivered BEFORE the write does not confirm it", async () => {
    // The write asks for off, but the read-back says coord resolves `on`
    // (a narrower row wins, say). The pre-write aggregate also says `on` —
    // it matches the read-back, and must still not confirm it.
    const pending = routeQueuedCi();
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "off",
      effective: tenantPolicy("on", "system"),
      readback_error: null,
    });
    render(<GithubHostedCiPanel isAdmin />);
    await act(async () => {
      pending[0]!.resolve(CI_VIEW);
    });
    await writeTenantOff();

    const awaiting = await screen.findByTestId(
      "github-hosted-ci-tenant-awaiting"
    );
    expect(awaiting).toHaveTextContent(/waiting for a fresh read/);
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective").textContent
    ).toBe("–");

    // The post-write read lands and agrees: now it is confirmed.
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => {
      pending[1]!.resolve(CI_VIEW);
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("github-hosted-ci-tenant-awaiting")
      ).toBeNull()
    );
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective")
    ).toHaveTextContent("On");
  });

  it("a read issued BEFORE the write but landing AFTER it does not confirm it", async () => {
    const pending = routeQueuedCi();
    httpPut.mockResolvedValue({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "off",
      effective: tenantPolicy("off", "tenant"),
      readback_error: null,
    });
    render(<GithubHostedCiPanel isAdmin />);
    await act(async () => {
      pending[0]!.resolve(CI_VIEW);
    });

    // A refresh issues read #2 and leaves it in flight…
    fireEvent.click(screen.getByTestId("github-hosted-ci-refresh"));
    await waitFor(() => expect(pending.length).toBe(2));
    // …then the write happens, issuing read #3 after it lands.
    await writeTenantOff();
    await waitFor(() => expect(pending.length).toBe(3));

    // Read #2 lands now, saying `off`. It was issued before the write.
    await act(async () => {
      pending[1]!.resolve(ciView("off", "tenant"));
    });
    expect(
      screen.getByTestId("github-hosted-ci-tenant-effective").textContent
    ).toBe("–");
    expect(
      screen.getByTestId("github-hosted-ci-tenant-awaiting")
    ).toBeInTheDocument();

    // Read #3 — issued after the write — is the one allowed to confirm.
    await act(async () => {
      pending[2]!.resolve(ciView("off", "tenant"));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("github-hosted-ci-tenant-effective")
      ).toHaveTextContent("Off")
    );
  });
});

describe("GithubHostedCiPanel — refresh retires read-back failures only on a confirmed read", () => {
  async function failARepoReadBack(
    pending: ReturnType<typeof deferred<unknown>>[]
  ) {
    httpPut.mockResolvedValueOnce({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "on",
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    await act(async () => {
      pending[0]!.resolve(CI_VIEW);
    });
    const web = await waitFor(() => rowFor("qontinui/qontinui-web"));
    fireEvent.click(within(web).getByRole("button", { expanded: false }));
    fireEvent.click(within(web).getByTestId("github-hosted-ci-repo-on"));
    await waitFor(() =>
      expect(
        rowFor("qontinui/qontinui-web")
          .querySelector("[data-status-kind]")
          ?.getAttribute("data-status-kind")
      ).toBe("unknown")
    );
  }

  const kindOf = (repo: string) =>
    rowFor(repo)
      .querySelector("[data-status-kind]")
      ?.getAttribute("data-status-kind");

  it("a refresh whose read succeeds clears it", async () => {
    const pending = routeQueuedCi();
    render(<GithubHostedCiPanel isAdmin />);
    await failARepoReadBack(pending);

    fireEvent.click(screen.getByTestId("github-hosted-ci-refresh"));
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => {
      pending[1]!.resolve(CI_VIEW);
    });
    await waitFor(() => expect(kindOf("qontinui/qontinui-web")).toBe("off"));
  });

  it("a refresh whose read fails keeps it", async () => {
    const pending = routeQueuedCi();
    render(<GithubHostedCiPanel isAdmin />);
    await failARepoReadBack(pending);

    fireEvent.click(screen.getByTestId("github-hosted-ci-refresh"));
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => {
      pending[1]!.reject(new Error("GET x failed: 502 - down"));
    });
    await screen.findByTestId("github-hosted-ci-repos-error");
    expect(kindOf("qontinui/qontinui-web")).toBe("unknown");
  });

  it("a refresh whose success is SUPERSEDED by a newer settled read keeps it", async () => {
    const pending = routeQueuedCi();
    render(<GithubHostedCiPanel isAdmin />);
    await failARepoReadBack(pending);

    // Refresh issues read #2 and leaves it in flight.
    fireEvent.click(screen.getByTestId("github-hosted-ci-refresh"));
    await waitFor(() => expect(pending.length).toBe(2));
    // A confirmed write on ANOTHER repo issues read #3, which fails first.
    httpPut.mockResolvedValueOnce({
      ok: true,
      domain: "github_hosted_ci",
      written_level: "off",
      effective: tenantPolicy("off", "repo"),
      readback_error: null,
    });
    const multi = rowFor("qontinui/multistate");
    fireEvent.click(within(multi).getByRole("button", { expanded: false }));
    fireEvent.click(within(multi).getByTestId("github-hosted-ci-repo-off"));
    await waitFor(() => expect(pending.length).toBe(3));
    await act(async () => {
      pending[2]!.reject(new Error("GET x failed: 502 - down"));
    });
    // Read #2 now succeeds — but a newer read already settled, so it is
    // discarded, and the refresh must NOT retire the read-back failure.
    await act(async () => {
      pending[1]!.resolve(CI_VIEW);
    });
    expect(kindOf("qontinui/qontinui-web")).toBe("unknown");
  });
});

describe("GithubHostedCiPanel — coord's named write refusals", () => {
  it.each([
    ["repo_not_in_tenant", /not one of this tenant's repos/],
    ["unknown_level", /not one this setting accepts/],
    ["repo_key_not_owner_name", /keyed owner\/name/],
  ])("renders %s legibly in the row", async (code, words) => {
    route({});
    httpPut.mockRejectedValue(
      new Error(
        `PUT /api/v1/operations/fleet-policy failed: 400 - {"detail":"{\\"error\\":\\"${code}\\"}"}`
      )
    );
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");
    const web = rowFor("qontinui/qontinui-web");
    fireEvent.click(within(web).getByRole("button", { expanded: false }));
    fireEvent.click(within(web).getByTestId("github-hosted-ci-repo-inherit"));

    const err = await within(rowFor("qontinui/qontinui-web")).findByTestId(
      "github-hosted-ci-repo-write-error"
    );
    expect(err).toHaveTextContent(words);
    expect(err).toHaveTextContent(/coord refused/);
  });

  it("an unnamed failure still says what failed", async () => {
    route({});
    httpPut.mockRejectedValue(
      new Error("PUT /api/v1/operations/fleet-policy failed: 502 - down")
    );
    render(<GithubHostedCiPanel isAdmin />);
    await screen.findAllByTestId("github-hosted-ci-repo-row");
    const web = rowFor("qontinui/qontinui-web");
    fireEvent.click(within(web).getByRole("button", { expanded: false }));
    fireEvent.click(within(web).getByTestId("github-hosted-ci-repo-on"));
    const err = await within(rowFor("qontinui/qontinui-web")).findByTestId(
      "github-hosted-ci-repo-write-error"
    );
    expect(err).toHaveTextContent(/502/);
  });
});
