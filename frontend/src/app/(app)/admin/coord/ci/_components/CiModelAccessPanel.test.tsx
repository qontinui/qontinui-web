/**
 * CiModelAccessPanel — plan `2026-10-13-ci-node-runs-model-dependent-eval-steps`
 * Phase 4: the panel states on, off, inherit and unknown, and coord's refusal
 * words (D12's grant refusals and the fleet-policy write refusals).
 *
 * Drives the REAL hooks against a mocked `httpClient`, so the wire bodies the
 * panel sends are asserted where they are built.
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
    // The typed /operations client reads over `httpClient.fetch`: GETs go to
    // `httpGet`, a PUT to `httpPut` with its parsed body; anything else throws.
    fetch: async (...a: unknown[]) => {
      const init = a[1] as RequestInit | undefined;
      const method = init?.method;
      if (method?.toUpperCase() === "PUT") {
        const out = await httpPut(a[0], JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(out ?? null), { status: 200 });
      }
      if (method !== undefined && method.toUpperCase() !== "GET") {
        throw new Error(
          `httpClient.fetch mock serves GET only; got ${method} ${String(a[0])}`
        );
      }
      return new Response(JSON.stringify(await httpGet(...a)), {
        status: 200,
      });
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { CiModelAccessPanel } from "./CiModelAccessPanel";

const WEB = "qontinui/qontinui-web";
const EVALS = "qontinui/qontinui-docs-evals";
const BROKEN = "qontinui/broken";

function policy(
  level: string,
  scope: string,
  canEdit = true
): Record<string, unknown> {
  return {
    domain: "ci_model_access",
    effective_level: level,
    master_enabled: true,
    resolved_scope: scope,
    can_edit: canEdit,
    keys_not_shown: [],
    keys_not_shown_source: null,
  };
}

function hostingList(repos: string[]): Record<string, unknown> {
  return {
    domain: "github_hosted_ci",
    tenant_default: {
      level: "on",
      resolved_scope: "none",
      unknown_reason: null,
    },
    repos: repos.map((repo) => ({
      repo,
      level: "on",
      resolved_scope: "none",
      unknown_reason: null,
    })),
    can_edit: true,
  };
}

type Answer = Record<string, unknown> | Error;

/**
 * Route the panel's GETs: the tenant read (`?domain=` alone), one read per
 * repo (`&repo=`), and the repo list (`/ci-hosting`).
 */
function route(opts: {
  tenant?: Answer;
  repos?: Record<string, Answer>;
  list?: Answer;
}) {
  const repos = opts.repos ?? {
    [WEB]: policy("on", "none"),
    [EVALS]: policy("on", "none"),
  };
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    const settle = (a: Answer) =>
      a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    if (u.includes("/ci-hosting")) {
      return settle(opts.list ?? hostingList(Object.keys(repos)));
    }
    if (u.includes("/fleet-policy")) {
      expect(u).toContain("domain=ci_model_access");
      const m = /[?&]repo=([^&]+)/.exec(u);
      if (m) {
        const repo = decodeURIComponent(m[1]);
        const a = repos[repo];
        return a
          ? settle(a)
          : Promise.reject(new Error(`unexpected repo ${repo}`));
      }
      return settle(opts.tenant ?? policy("on", "none"));
    }
    return Promise.reject(new Error(`unexpected GET ${u}`));
  });
}

function rowFor(repo: string): HTMLElement {
  const row = screen
    .getAllByTestId("ci-model-access-repo-row")
    .find((el) => el.getAttribute("data-row-key") === repo);
  if (!row) throw new Error(`no row for ${repo}`);
  return row;
}

async function expand(repo: string): Promise<HTMLElement> {
  await screen.findAllByTestId("ci-model-access-repo-row");
  const row = rowFor(repo);
  fireEvent.click(within(row).getByRole("button", { expanded: false }));
  return rowFor(repo);
}

function statusOf(repo: string): string | null {
  return within(rowFor(repo))
    .getByTestId("ci-model-access-repo-status")
    .getAttribute("data-status");
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage — the panel defaults open either way.
  }
});

describe("CiModelAccessPanel — copy", () => {
  it("says what it governs, that the default is on, and what off does", async () => {
    route({});
    render(<CiModelAccessPanel isAdmin />);
    const copy = await screen.findByTestId("ci-model-access-explainer");
    expect(copy).toHaveTextContent("[model]");
    expect(copy).toHaveTextContent(/on by default/);
    expect(copy).toHaveTextContent(/steps still run/);
    expect(copy).toHaveTextContent(/rows read UNKNOWN/);
    expect(copy).toHaveTextContent(/may belong to other members/);
  });
});

describe("CiModelAccessPanel — on", () => {
  it("a tenant with no row renders On from the default, and repos inherit it", async () => {
    route({});
    render(<CiModelAccessPanel isAdmin />);

    await waitFor(() =>
      expect(
        screen.getByTestId("ci-model-access-tenant-effective")
      ).toHaveTextContent("On")
    );
    expect(
      screen.getByTestId("ci-model-access-tenant-source")
    ).toHaveTextContent("default (on)");
    await waitFor(() => expect(statusOf(WEB)).toBe("on"));
    expect(
      screen.getByTestId("ci-model-access-summary-repos")
    ).toHaveTextContent("repos on 2 · off 0");

    const row = await expand(WEB);
    expect(within(row).queryByTestId("ci-model-access-refusal")).toBeNull();
    expect(row).toHaveTextContent(/allowed for this repo/);
    // An inheriting repo highlights Inherit, so the button for it is disabled.
    expect(
      within(row).getByTestId("ci-model-access-repo-inherit")
    ).toBeDisabled();
    expect(within(row).getByTestId("ci-model-access-repo-off")).toBeEnabled();
  });
});

describe("CiModelAccessPanel — off", () => {
  it("a tenant OFF renders Off from the tenant setting; inheriting repos read preference_off_tenant", async () => {
    route({
      tenant: policy("off", "tenant"),
      repos: { [WEB]: policy("off", "tenant") },
    });
    render(<CiModelAccessPanel isAdmin />);

    await waitFor(() =>
      expect(
        screen.getByTestId("ci-model-access-tenant-effective")
      ).toHaveTextContent("Off")
    );
    expect(
      screen.getByTestId("ci-model-access-tenant-source")
    ).toHaveTextContent("tenant setting");
    await waitFor(() => expect(statusOf(WEB)).toBe("off"));

    const row = await expand(WEB);
    expect(
      within(row).getByTestId("ci-model-access-refusal")
    ).toHaveTextContent("preference_off_tenant");
    expect(row).toHaveTextContent(/steps still run/);
    expect(row).toHaveTextContent(/read UNKNOWN/);
  });

  it("a repo override OFF reads preference_off_repo and highlights Off", async () => {
    route({
      repos: { [WEB]: policy("off", "repo"), [EVALS]: policy("on", "none") },
    });
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() => expect(statusOf(WEB)).toBe("off"));
    expect(
      within(rowFor(WEB)).getByText(/from repo override/)
    ).toBeInTheDocument();

    const row = await expand(WEB);
    expect(
      within(row).getByTestId("ci-model-access-refusal")
    ).toHaveTextContent("preference_off_repo");
    expect(within(row).getByTestId("ci-model-access-repo-off")).toBeDisabled();
    expect(
      within(row).getByTestId("ci-model-access-repo-inherit")
    ).toBeEnabled();
  });

  it("turning the tenant OFF writes the tenant band, then re-reads the repos", async () => {
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "ci_model_access",
      written_level: "off",
      effective: policy("off", "tenant"),
      readback_error: null,
    });
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() =>
      expect(screen.getByTestId("ci-model-access-tenant-off")).toBeEnabled()
    );
    fireEvent.click(screen.getByTestId("ci-model-access-tenant-off"));

    await waitFor(() => expect(httpPut).toHaveBeenCalledTimes(1));
    expect(httpPut.mock.calls[0][1]).toMatchObject({
      domain: "ci_model_access",
      scope_band: "tenant",
      scope_key: null,
      level: "off",
      master_enabled: true,
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("ci-model-access-tenant-effective")
      ).toHaveTextContent("Off")
    );
    await waitFor(() =>
      expect(
        httpGet.mock.calls.filter((c) => String(c[0]).includes("/ci-hosting"))
          .length
      ).toBeGreaterThanOrEqual(2)
    );
  });
});

describe("CiModelAccessPanel — inherit", () => {
  it("Inherit writes the repo band, then updates ONLY that repo from the read-back", async () => {
    route({
      repos: { [WEB]: policy("off", "repo"), [EVALS]: policy("on", "none") },
    });
    httpPut.mockResolvedValue({
      ok: true,
      domain: "ci_model_access",
      written_level: "inherit",
      effective: policy("on", "none"),
      readback_error: null,
    });
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() => expect(statusOf(WEB)).toBe("off"));
    const row = await expand(WEB);
    fireEvent.click(within(row).getByTestId("ci-model-access-repo-inherit"));

    await waitFor(() => expect(httpPut).toHaveBeenCalledTimes(1));
    const [url, body] = httpPut.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe("/api/v1/operations/fleet-policy");
    expect(body).toMatchObject({
      domain: "ci_model_access",
      scope_band: "repo",
      scope_key: WEB,
      level: "inherit",
      master_enabled: true,
    });
    // The row takes the write's read-back (on, from the default)…
    await waitFor(() => expect(statusOf(WEB)).toBe("on"));
    // …without re-reading the list or any repo.
    expect(
      httpGet.mock.calls.filter((c) => String(c[0]).includes("/ci-hosting"))
        .length
    ).toBe(1);
    expect(
      httpGet.mock.calls.filter((c) => String(c[0]).includes("&repo=")).length
    ).toBe(2);
  });

  it("a failed read-back renders THAT repo UNKNOWN and highlights no choice", async () => {
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "ci_model_access",
      written_level: "off",
      effective: null,
      readback_error: "read-back failed: coord returned 503",
    });
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() => expect(statusOf(WEB)).toBe("on"));
    const row = await expand(WEB);
    fireEvent.click(within(row).getByTestId("ci-model-access-repo-off"));

    await waitFor(() => expect(statusOf(WEB)).toBe("unknown"));
    expect(statusOf(EVALS)).toBe("on");
    for (const c of ["inherit", "on", "off"]) {
      expect(
        within(rowFor(WEB)).getByTestId(`ci-model-access-repo-${c}`)
      ).toBeEnabled();
    }
  });
});

describe("CiModelAccessPanel — unknown", () => {
  it("an unreadable tenant value renders UNKNOWN with its reason, never On", async () => {
    route({
      tenant: new Error("GET /api/v1/operations/fleet-policy failed: 503 - x"),
    });
    render(<CiModelAccessPanel isAdmin />);
    const unknown = await screen.findByTestId("ci-model-access-tenant-unknown");
    expect(unknown).toHaveTextContent(/503/);
    // A failed read HERE is not coord refusing: coord's word is named only as
    // what it would do if it could not read the value either.
    expect(unknown).toHaveTextContent(/could not be read here/);
    expect(unknown).toHaveTextContent(/If coord cannot read it either/);
    expect(unknown).toHaveTextContent("preference_unknown");
    const value = screen.getByTestId("ci-model-access-tenant-effective");
    expect(value.textContent).toBe("–");
    expect(value.getAttribute("data-level")).toBe("unknown");
  });

  it("`off` with no row behind it is UNKNOWN — the default is on, so nothing chose off", async () => {
    // What a coord that predates the domain answers (the generic off default),
    // and what the web proxy floors a missing level to.
    route({
      tenant: policy("off", "none"),
      repos: { [WEB]: policy("off", "none") },
    });
    render(<CiModelAccessPanel isAdmin />);
    const unknown = await screen.findByTestId("ci-model-access-tenant-unknown");
    expect(unknown).toHaveTextContent(/defaults to on/);
    expect(
      screen.getByTestId("ci-model-access-tenant-effective").textContent
    ).toBe("–");
    await waitFor(() => expect(statusOf(WEB)).toBe("unknown"));
  });

  it("one repo's failed read is UNKNOWN for that repo only, with preference_unknown", async () => {
    route({
      repos: {
        [WEB]: policy("on", "none"),
        [BROKEN]: new Error("GET fleet-policy failed: 500 - boom"),
      },
    });
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() => expect(statusOf(BROKEN)).toBe("unknown"));
    expect(statusOf(WEB)).toBe("on");
    expect(
      screen.getByTestId("ci-model-access-summary-repos")
    ).toHaveTextContent("repos on 1 · off 0 · unknown 1");

    const row = await expand(BROKEN);
    expect(
      within(row).getByTestId("ci-model-access-refusal")
    ).toHaveTextContent("preference_unknown");
    expect(row).toHaveTextContent(/500/);
    expect(row).toHaveTextContent(/could not be read here/);
    expect(row).toHaveTextContent(/If coord cannot read it either/);
    expect(row).not.toHaveTextContent(/Coord refuses model access/);
    // UNKNOWN highlights no choice.
    for (const c of ["inherit", "on", "off"]) {
      expect(
        within(row).getByTestId(`ci-model-access-repo-${c}`)
      ).toBeEnabled();
    }
  });

  it("a repo list coord could not read is UNKNOWN with its reason, not 'no repos'", async () => {
    route({
      list: {
        ...hostingList([]),
        repos_unknown_reason: "schema_object_missing:tenant_repos",
      },
    });
    render(<CiModelAccessPanel isAdmin />);
    const err = await screen.findByTestId("ci-model-access-repos-error");
    expect(err).toHaveTextContent("schema_object_missing:tenant_repos");
    expect(screen.queryByTestId("ci-model-access-repos-empty")).toBeNull();
  });

  it("an older read that succeeds after a newer one failed is still shown, labelled stale", async () => {
    // Read 1 (mount) hangs; read 2 (Refresh) fails; then read 1 answers. A
    // newest-issued guard would throw read 1's real answer away.
    let releaseFirst!: (v: unknown) => void;
    let listCalls = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/ci-hosting")) {
        listCalls += 1;
        if (listCalls === 1)
          return new Promise((res) => {
            releaseFirst = res;
          });
        return Promise.reject(new Error("GET ci-hosting failed: 503"));
      }
      if (u.includes("&repo=")) return Promise.resolve(policy("off", "repo"));
      return Promise.resolve(policy("on", "none"));
    });
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() => expect(listCalls).toBe(1));
    fireEvent.click(screen.getByTestId("ci-model-access-refresh"));
    await screen.findByTestId("ci-model-access-repos-error");

    releaseFirst(hostingList([WEB]));
    await waitFor(() => expect(statusOf(WEB)).toBe("off"));
    // Shown, but marked as not re-confirmed by the newest read.
    expect(
      screen.getByTestId("ci-model-access-summary-repos").textContent
    ).toContain("(stale)");
  });

  it("an unreadable repo list is UNKNOWN, not an empty list", async () => {
    route({ list: new Error("GET /api/v1/operations/ci-hosting failed: 404") });
    render(<CiModelAccessPanel isAdmin />);
    const err = await screen.findByTestId("ci-model-access-repos-error");
    expect(err).toHaveTextContent(/Nothing is shown in their place/);
    expect(screen.queryByTestId("ci-model-access-repos-empty")).toBeNull();
    expect(
      screen.getByTestId("ci-model-access-summary-repos").textContent
    ).toContain("repos –");
  });
});

describe("CiModelAccessPanel — coord's named write refusals", () => {
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
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() => expect(statusOf(WEB)).toBe("on"));
    const row = await expand(WEB);
    fireEvent.click(within(row).getByTestId("ci-model-access-repo-off"));
    const err = await within(rowFor(WEB)).findByTestId(
      "ci-model-access-repo-write-error"
    );
    expect(err).toHaveTextContent(words);
    expect(err).toHaveTextContent(/coord refused/);
  });
});

describe("CiModelAccessPanel — pinning the tenant value", () => {
  it("an On that comes from the no-row default can be pinned explicitly", async () => {
    route({});
    httpPut.mockResolvedValue({
      ok: true,
      domain: "ci_model_access",
      written_level: "on",
      effective: policy("on", "tenant"),
      readback_error: null,
    });
    render(<CiModelAccessPanel isAdmin />);
    await waitFor(() =>
      expect(
        screen.getByTestId("ci-model-access-tenant-source")
      ).toHaveTextContent("default (on)")
    );
    const on = screen.getByTestId("ci-model-access-tenant-on");
    expect(on).toBeEnabled();
    fireEvent.click(on);
    await waitFor(() => expect(httpPut).toHaveBeenCalledTimes(1));
    expect(httpPut.mock.calls[0][1]).toMatchObject({
      scope_band: "tenant",
      level: "on",
    });
    // Once the tenant row holds it, writing it again is not offered.
    await waitFor(() =>
      expect(
        screen.getByTestId("ci-model-access-tenant-source")
      ).toHaveTextContent("tenant setting")
    );
    expect(screen.getByTestId("ci-model-access-tenant-on")).toBeDisabled();
  });
});

describe("CiModelAccessPanel — read-only", () => {
  it("is read-only for a non-admin of the active tenant", async () => {
    route({});
    render(<CiModelAccessPanel isAdmin={false} />);
    expect(
      await screen.findByTestId("ci-model-access-readonly")
    ).toBeInTheDocument();
    expect(screen.getByTestId("ci-model-access-tenant-off")).toBeDisabled();
    await waitFor(() => expect(statusOf(WEB)).toBe("on"));
    const row = await expand(WEB);
    expect(within(row).getByTestId("ci-model-access-repo-off")).toBeDisabled();
  });

  it("is read-only when the backend says can_edit false, even for an admin", async () => {
    route({ tenant: policy("on", "none", false) });
    render(<CiModelAccessPanel isAdmin />);
    expect(
      await screen.findByTestId("ci-model-access-readonly")
    ).toBeInTheDocument();
    expect(screen.getByTestId("ci-model-access-tenant-on")).toBeDisabled();
  });
});
