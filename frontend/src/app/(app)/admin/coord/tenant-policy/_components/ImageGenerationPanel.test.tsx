/**
 * ImageGenerationPanel — plan
 * `2026-10-13-image-generation-and-visual-judgment` Phase 12 step 2.
 *
 * Drives the REAL hooks against a mocked `httpClient` (the
 * `GithubHostedCiPanel.test.tsx` shape), so every state is rendered from the
 * wire answer it comes from and every write is asserted as the body it sends.
 * The states that must never collapse into a level: a coord that predates the
 * domain, an unrecognised level, a failed read, an unlisted override list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method ?? "GET";
      const body = JSON.parse(init.body ?? "null");
      let out: unknown;
      if (method === "GET") out = await getMock(url);
      else if (method === "PUT") out = await putMock(url, body);
      else throw new Error(`fetch mock: unexpected ${method} ${url}`);
      return out instanceof Response
        ? out
        : new Response(JSON.stringify(out ?? null));
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { ImageGenerationPanel } from "./ImageGenerationPanel";

type Override = {
  repo: string;
  level: string;
  master_enabled: boolean;
  effective_level: string;
};

function view(
  level: string,
  scope: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    domain: "image_generation",
    effective_level: level,
    master_enabled: level !== "off",
    resolved_scope: scope,
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
    repo_overrides: [] as Override[],
    ...extra,
  };
}

const SITE_LOCAL: Override = {
  repo: "acme/site",
  level: "local_only",
  master_enabled: true,
  effective_level: "local_only",
};

const written = (effective: unknown, level: string) => ({
  ok: true,
  domain: "image_generation",
  written_level: level,
  written_master_enabled: true,
  versioned: true,
  version: 2,
  updated_by: "operator@example.com",
  effective,
  readback_error: null,
});

async function renderWith(first: Record<string, unknown> | Error) {
  if (first instanceof Error) getMock.mockRejectedValueOnce(first);
  else getMock.mockResolvedValueOnce(first);
  render(<ImageGenerationPanel />);
  await waitFor(() =>
    expect(screen.getByTestId("image-generation-blurb")).toBeTruthy()
  );
}

const effective = () => screen.getByTestId("image-generation-effective");
const blurb = () => screen.getByTestId("image-generation-blurb").textContent;

beforeEach(() => {
  // reset, not clear: a test that fails mid-write must not leave queued
  // `mock*Once` answers behind for the next test to consume.
  vi.resetAllMocks();
});

describe("ImageGenerationPanel — the tenant level", () => {
  it("a tenant with no row shows On as the default, and says nobody chose it", async () => {
    await renderWith(view("on", "none"));

    expect(effective().textContent).toBe("On");
    expect(effective().getAttribute("data-level")).toBe("on");
    expect(screen.getByTestId("image-generation-scope").textContent).toBe(
      "none"
    );
    expect(screen.getByTestId("image-generation-no-row").textContent).toMatch(
      /nobody chose this: On is image generation's default/
    );
    expect(blurb()).toMatch(/agents may generate images/);
  });

  it("shows local only, and what it keeps on the machine", async () => {
    await renderWith(view("local_only", "tenant"));
    expect(effective().textContent).toBe("Local only");
    expect(effective().getAttribute("data-level")).toBe("local_only");
    expect(blurb()).toMatch(/only on the fleet's own hardware/);
    expect(screen.queryByTestId("image-generation-no-row")).toBeNull();
  });

  it("shows off, and that requests are refused", async () => {
    await renderWith(view("off", "tenant", { master_enabled: true }));
    expect(effective().textContent).toBe("Off");
    expect(blurb()).toMatch(/no image be generated/);
    expect(blurb()).toMatch(/refused with a reason that names this setting/);
  });

  it("a coord that predates the domain (no row, `off`) is UNKNOWN — never On, never Off", async () => {
    await renderWith(view("off", "none", { repo_overrides: undefined }));

    expect(effective().textContent).toBe("unknown");
    expect(effective().getAttribute("data-level")).toBe("unknown");
    expect(effective().className).toMatch(/amber/);
    const notice = screen.getByTestId("image-generation-undeclared-default");
    expect(notice.querySelector("code")?.textContent).toBe("off");
    expect(notice.textContent).toMatch(/What coord resolves is unknown/);
    expect(blurb()).toMatch(/unknown/);
    expect(screen.queryByTestId("image-generation-no-row")).toBeNull();
    // No level button is pressed as though it were in force.
    for (const level of ["on", "local_only", "off"]) {
      expect(
        screen.getByTestId(`image-generation-${level}`).getAttribute("class")
      ).toBe(screen.getByTestId("image-generation-on").getAttribute("class"));
    }
  });

  it("an unrecognised level is UNKNOWN and named", async () => {
    await renderWith(view("maybe", "tenant"));
    expect(effective().textContent).toBe("unknown");
    expect(
      screen.getByTestId("image-generation-unrecognized").querySelector("code")
        ?.textContent
    ).toBe("maybe");
  });

  it("a failed read is unknown everywhere it shows", async () => {
    await renderWith(new Error("HTTP 502"));

    expect(effective().textContent).toBe("unknown");
    expect(screen.getByTestId("image-generation-error").textContent).toMatch(
      /HTTP 502.*The current value is unknown/
    );
    expect(screen.getByTestId("image-generation-readonly").textContent).toMatch(
      /could not be read/
    );
    expect(
      screen.getByTestId("image-generation-overrides-unknown").textContent
    ).toMatch(/unknown until the setting can be read/);
    expect(blurb()).toMatch(/could not be read/);
  });

  it("explains that a system-band answer means a tenant write takes effect", async () => {
    await renderWith(view("on", "system"));
    expect(
      screen.getByTestId("image-generation-system-fallback").textContent
    ).toMatch(/takes effect immediately/);
  });

  it("disables every write for a non-admin and says why", async () => {
    await renderWith(
      view("on", "tenant", { can_edit: false, repo_overrides: [SITE_LOCAL] })
    );
    expect(
      (screen.getByTestId("image-generation-off") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("image-generation-add-repo") as HTMLInputElement)
        .disabled
    ).toBe(true);
    expect(screen.getByTestId("image-generation-readonly").textContent).toMatch(
      /not an admin/
    );
  });

  it("writes the clicked level at the tenant band and shows the read-back", async () => {
    await renderWith(view("on", "none"));
    putMock.mockResolvedValue(
      written(view("local_only", "tenant"), "local_only")
    );

    fireEvent.click(screen.getByTestId("image-generation-local_only"));

    await waitFor(() => expect(effective().textContent).toBe("Local only"));
    expect(putMock).toHaveBeenCalledWith("/api/v1/operations/fleet-policy", {
      domain: "image_generation",
      scope_band: "tenant",
      scope_key: null,
      level: "local_only",
      master_enabled: true,
      change_note: 'Set image generation to "local_only" from the console',
    });
  });

  it("names the refresh control", async () => {
    await renderWith(view("on", "tenant"));
    const refresh = screen.getByTestId("image-generation-refresh");
    expect(refresh.getAttribute("aria-label")).toBe("Refresh");
  });

  it("says plainly that the setting is recorded but not yet enforced", async () => {
    // No Studio build reads this dial yet (plan Phase 12 step 3), so no copy
    // may say Studio checks it, resolves it, or that older builds ignore it.
    await renderWith(view("off", "tenant", { repo_overrides: [SITE_LOCAL] }));
    expect(
      screen.getByTestId("image-generation-not-enforced").textContent
    ).toMatch(
      /Recorded, not yet enforced\..*No Studio build reads this setting yet/
    );
    const row = screen.getByTestId("image-generation-override-row");
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    const text =
      screen.getByTestId("image-generation-policy").textContent ?? "";
    expect(text).not.toMatch(/Studio (checks|resolves|does)/);
    expect(text).not.toMatch(/ignore it/);
  });
});

describe("ImageGenerationPanel — per-repo overrides", () => {
  it("says so when no repo overrides the tenant setting", async () => {
    await renderWith(view("on", "tenant"));
    expect(
      screen.getByTestId("image-generation-overrides-empty").textContent
    ).toMatch(/every repo follows the tenant setting/);
  });

  it("a coord that sends no list renders the list UNKNOWN, not empty", async () => {
    await renderWith(view("on", "tenant", { repo_overrides: undefined }));
    expect(
      screen.getByTestId("image-generation-overrides-unknown").textContent
    ).toMatch(/does not list per-repo overrides/);
    expect(screen.queryByTestId("image-generation-overrides-empty")).toBeNull();
  });

  it("lists each override with its level, and an unknown one as unknown", async () => {
    await renderWith(
      view("on", "tenant", {
        repo_overrides: [
          SITE_LOCAL,
          {
            repo: "acme/odd",
            level: "maybe",
            master_enabled: true,
            effective_level: "maybe",
          },
        ],
      })
    );
    const rows = screen.getAllByTestId("image-generation-override-row");
    expect(rows.map((r) => r.getAttribute("data-row-key"))).toEqual([
      "acme/site",
      "acme/odd",
    ]);
    expect(within(rows[0]).getByText("Local only")).toBeTruthy();
    expect(
      within(rows[0]).getByText("overrides the tenant setting (On)")
    ).toBeTruthy();
    expect(within(rows[1]).getByText("–")).toBeTruthy();
    expect(
      rows[1]
        .querySelector("[data-console-row]")
        ?.getAttribute("data-attention")
    ).toBe("waiting");
  });

  it("clears an override with Inherit and re-reads the list", async () => {
    await renderWith(view("on", "tenant", { repo_overrides: [SITE_LOCAL] }));
    putMock.mockResolvedValue(written(view("on", "tenant"), "inherit"));
    getMock.mockResolvedValueOnce(view("on", "tenant", { repo_overrides: [] }));

    const row = screen.getByTestId("image-generation-override-row");
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    const detail = screen.getByTestId("image-generation-override-detail");
    // The override's own level is the one pressed.
    expect(
      (
        within(detail).getByTestId(
          "image-generation-override-local_only"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(
      within(detail).getByTestId("image-generation-override-inherit")
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("image-generation-overrides-empty")
      ).toBeTruthy()
    );
    expect(putMock).toHaveBeenCalledWith("/api/v1/operations/fleet-policy", {
      domain: "image_generation",
      scope_band: "repo",
      scope_key: "acme/site",
      level: "inherit",
      master_enabled: true,
      change_note:
        'Set image generation for acme/site to "inherit" from the console',
    });
  });

  it("spins only the override button that was clicked while its write is in flight", async () => {
    await renderWith(view("on", "tenant", { repo_overrides: [SITE_LOCAL] }));
    let release!: (v: unknown) => void;
    putMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    getMock.mockResolvedValueOnce(
      view("on", "tenant", {
        repo_overrides: [
          { ...SITE_LOCAL, level: "off", effective_level: "off" },
        ],
      })
    );

    const row = screen.getByTestId("image-generation-override-row");
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    const detail = screen.getByTestId("image-generation-override-detail");
    fireEvent.click(
      within(detail).getByTestId("image-generation-override-off")
    );

    const spinning = (choice: string) =>
      screen
        .getByTestId(`image-generation-override-${choice}`)
        .querySelector(".animate-spin") !== null;
    await waitFor(() => expect(spinning("off")).toBe(true));
    for (const choice of ["on", "local_only", "inherit"]) {
      expect(spinning(choice), choice).toBe(false);
    }

    release(written(view("on", "tenant"), "off"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("image-generation-policy")
          .querySelector(".animate-spin")
      ).toBeNull()
    );
  });

  it("adds an override for a typed repo, sent the way coord stores it", async () => {
    await renderWith(view("on", "tenant"));
    putMock.mockResolvedValue(written(view("off", "repo"), "off"));
    getMock.mockResolvedValueOnce(
      view("on", "tenant", {
        repo_overrides: [
          {
            repo: "acme/site",
            level: "off",
            master_enabled: true,
            effective_level: "off",
          },
        ],
      })
    );

    const input = screen.getByTestId(
      "image-generation-add-repo"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " Acme/Site " } });
    fireEvent.click(screen.getByTestId("image-generation-add-off"));

    await waitFor(() =>
      expect(
        screen.getAllByTestId("image-generation-override-row")
      ).toHaveLength(1)
    );
    expect(putMock.mock.calls[0][1]).toMatchObject({
      scope_band: "repo",
      scope_key: "acme/site",
      level: "off",
    });
    expect(input.value).toBe("");
  });

  it("refuses to send a repo that is not owner/name, and says why", async () => {
    await renderWith(view("on", "tenant"));
    fireEvent.change(screen.getByTestId("image-generation-add-repo"), {
      target: { value: "qontinui-web" },
    });
    for (const level of ["on", "local_only", "off"]) {
      expect(
        (
          screen.getByTestId(
            `image-generation-add-${level}`
          ) as HTMLButtonElement
        ).disabled
      ).toBe(true);
    }
    expect(screen.getByTestId("image-generation-add-hint").textContent).toMatch(
      /owner\/name/
    );
    expect(putMock).not.toHaveBeenCalled();
  });

  it("warns that a level set for a repo with an override replaces it", async () => {
    await renderWith(view("on", "tenant", { repo_overrides: [SITE_LOCAL] }));
    fireEvent.change(screen.getByTestId("image-generation-add-repo"), {
      target: { value: "ACME/site" },
    });
    expect(
      screen.getByTestId("image-generation-add-existing").textContent
    ).toMatch(/acme\/site already has an override \(Local only\)/);
  });

  it("names coord's refusal under the form", async () => {
    await renderWith(view("on", "tenant"));
    putMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: "repo_key_not_owner_name" }), {
          status: 400,
        })
    );
    fireEvent.change(screen.getByTestId("image-generation-add-repo"), {
      target: { value: "acme/site" },
    });
    fireEvent.click(screen.getByTestId("image-generation-add-on"));

    await waitFor(() =>
      expect(
        screen.getByTestId("image-generation-add-error").textContent
      ).toMatch(/must be keyed owner\/name/)
    );
  });
});
