/**
 * Model & effort by spawn type — plan
 * `2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type` Phase 5.
 *
 * Runs through the real client, the real write classifier and the hook, over
 * the page's one transport fake (`spawnsRoutes.ts`). Pins: coord's rows render
 * with their source and last writer; a save sends the full pair and the row
 * shows the PUT's answer (the read-back), not the request; inherit is sent as
 * `null`; a failed GET is UNKNOWN, never "Inherit"; an open write outcome is
 * UNKNOWN until a re-read answers; a refusal keeps coord's value.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

let routes: SpawnsRoutes = defaultSpawnsRoutes();
const calls: { method: string; url: string; body: unknown }[] = [];

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({
        method: (init?.method ?? "GET").toUpperCase(),
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return answerSpawnsRequest(routes, url, init);
    },
  },
}));

import {
  answerSpawnsRequest,
  defaultSpawnsRoutes,
  launchSettingsBody,
  type SpawnsRoutes,
} from "../__fixtures__/spawnsRoutes";
import {
  SpawnLaunchSettingsPanel,
  modelFamilyLabel,
  spawnTypeLabel,
} from "./SpawnLaunchSettingsPanel";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderPanel() {
  render(<SpawnLaunchSettingsPanel />);
  await settle();
}

function row(spawnType: string): HTMLElement {
  const found = screen
    .getAllByTestId("spawn-launch-row")
    .find((r) => r.getAttribute("data-spawn-type") === spawnType);
  if (!found) throw new Error(`no row for ${spawnType}`);
  return found;
}

function selectOf(spawnType: string, field: "model" | "effort") {
  return within(row(spawnType)).getByTestId(
    `spawn-launch-${field}`
  ) as HTMLSelectElement;
}

async function saveRow(spawnType: string) {
  await act(async () => {
    fireEvent.click(within(row(spawnType)).getByTestId("spawn-launch-save"));
  });
  await settle();
}

const puts = () => calls.filter((c) => c.method === "PUT");

beforeEach(() => {
  calls.length = 0;
  routes = defaultSpawnsRoutes();
});

describe("labels", () => {
  it("humanizes a spawn type and names a family's latest model", () => {
    expect(spawnTypeLabel("post_merge")).toBe("Post merge");
    expect(spawnTypeLabel("pr_fix_red_ci")).toBe("PR fix red CI");
    expect(modelFamilyLabel("sonnet")).toBe("Sonnet (latest)");
  });
});

describe("SpawnLaunchSettingsPanel", () => {
  it("renders one row per type coord serves, with its values, source and last writer", async () => {
    await renderPanel();
    expect(screen.getAllByTestId("spawn-launch-row")).toHaveLength(2);

    expect(within(row("post_merge")).getByText("Post merge")).toBeTruthy();
    expect(
      within(row("post_merge")).getByText(
        "Follow-up sessions spawned after a pull request merges."
      )
    ).toBeTruthy();
    expect(selectOf("post_merge", "model").value).toBe("sonnet");
    expect(selectOf("post_merge", "effort").value).toBe("");
    expect(
      within(row("post_merge")).getByTestId("spawn-launch-source").textContent
    ).toBe("stored");
    expect(
      within(row("post_merge")).getByTestId("spawn-launch-last-set").textContent
    ).toContain("operator@example.test");

    expect(selectOf("vet_plan", "model").value).toBe("");
    expect(
      within(row("vet_plan")).getByTestId("spawn-launch-source").textContent
    ).toBe("default");

    const options = Array.from(selectOf("vet_plan", "model").options).map(
      (o) => o.textContent
    );
    expect(options).toEqual([
      "Inherit from originating session",
      "Fable (latest)",
      "Opus (latest)",
      "Sonnet (latest)",
      "Haiku (latest)",
    ]);
    const efforts = Array.from(selectOf("vet_plan", "effort").options).map(
      (o) => o.value
    );
    expect(efforts).toEqual(["", "low", "medium", "high", "xhigh", "max"]);
    expect(screen.getByTestId("spawn-launch-settings").textContent).toContain(
      "Ultracode is not set here"
    );
  });

  it("saves the full pair and shows the PUT's answer, not the request", async () => {
    // Coord stores something other than what was asked: the row must show it.
    routes.putLaunchSetting = (spawnType) => ({
      body: {
        spawn_type: spawnType,
        description: "Sessions that vet a plan.",
        model: "opus",
        effort: "high",
        source: "stored",
        updated_by: "someone-else@example.test",
        updated_at: "2026-11-15T12:00:00Z",
      },
    });
    await renderPanel();
    fireEvent.change(selectOf("vet_plan", "model"), {
      target: { value: "haiku" },
    });
    fireEvent.change(selectOf("vet_plan", "effort"), {
      target: { value: "xhigh" },
    });
    await saveRow("vet_plan");

    expect(puts()).toHaveLength(1);
    expect(puts()[0]?.url).toBe("/api/v1/spawn-launch-settings/vet_plan");
    expect(puts()[0]?.body).toEqual({ model: "haiku", effort: "xhigh" });

    expect(selectOf("vet_plan", "model").value).toBe("opus");
    expect(selectOf("vet_plan", "effort").value).toBe("high");
    expect(
      within(row("vet_plan")).getByTestId("spawn-launch-source").textContent
    ).toBe("stored");
    expect(
      within(row("vet_plan")).getByTestId("spawn-launch-last-set").textContent
    ).toContain("someone-else@example.test");
    expect(
      within(row("vet_plan")).getByTestId("spawn-launch-saved")
    ).toBeTruthy();
  });

  it("sends inherit as null", async () => {
    await renderPanel();
    fireEvent.change(selectOf("post_merge", "model"), {
      target: { value: "" },
    });
    await saveRow("post_merge");
    expect(puts()[0]?.body).toEqual({ model: null, effort: null });
    expect(selectOf("post_merge", "model").value).toBe("");
  });

  it("renders UNKNOWN when the GET fails — never Inherit", async () => {
    routes.launchSettings = () => ({
      status: 503,
      body: { detail: "coord unavailable" },
    });
    await renderPanel();
    const unknown = screen.getByTestId("spawn-launch-unknown");
    expect(unknown.textContent).toContain("UNKNOWN");
    expect(screen.queryByTestId("spawn-launch-row")).toBeNull();
    expect(screen.queryByTestId("spawn-launch-model")).toBeNull();
    expect(screen.queryByText("Inherit from originating session")).toBeNull();
  });

  it("keeps the last good rows, labelled stale, when a refresh fails", async () => {
    await renderPanel();
    routes.launchSettings = () => ({ status: 500, body: { detail: "boom" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("spawn-launch-refresh"));
    });
    await settle();
    expect(screen.getByTestId("spawn-launch-stale")).toBeTruthy();
    expect(selectOf("post_merge", "model").value).toBe("sonnet");
  });

  it("an open write outcome is UNKNOWN until a re-read answers", async () => {
    let reads = 0;
    routes.launchSettings = () => {
      reads += 1;
      return { body: launchSettingsBody() };
    };
    routes.putLaunchSetting = () => ({
      status: 504,
      body: { detail: "timeout waiting for coord" },
    });
    await renderPanel();
    expect(reads).toBe(1);
    fireEvent.change(selectOf("vet_plan", "model"), {
      target: { value: "opus" },
    });
    await saveRow("vet_plan");
    // The write was sent once, and a re-read followed it.
    expect(puts()).toHaveLength(1);
    expect(reads).toBe(2);
    // The re-read answered, so the row shows coord's value again.
    expect(selectOf("vet_plan", "model").value).toBe("");
    expect(
      within(row("vet_plan")).queryByTestId("spawn-launch-refused")
    ).toBeNull();
  });

  it("stays UNKNOWN while the re-read after an open write fails", async () => {
    await renderPanel();
    routes.putLaunchSetting = () => ({ status: 504, body: { detail: "t/o" } });
    routes.launchSettings = () => ({ status: 503, body: { detail: "down" } });
    fireEvent.change(selectOf("vet_plan", "model"), {
      target: { value: "opus" },
    });
    await saveRow("vet_plan");
    expect(
      within(row("vet_plan")).getByTestId("spawn-launch-model-unknown")
    ).toBeTruthy();
    // The pre-write source and writer are not shown as current either.
    expect(
      within(row("vet_plan")).getByTestId("spawn-launch-source-unknown")
    ).toBeTruthy();
    expect(
      within(row("vet_plan")).queryByTestId("spawn-launch-source")
    ).toBeNull();
  });

  it("a refusal keeps coord's value and says it was not applied", async () => {
    routes.putLaunchSetting = () => ({
      status: 403,
      body: { detail: "not_coord_tenant_admin" },
    });
    await renderPanel();
    fireEvent.change(selectOf("post_merge", "model"), {
      target: { value: "opus" },
    });
    await saveRow("post_merge");
    expect(
      within(row("post_merge")).getByTestId("spawn-launch-refused").textContent
    ).toContain("Not applied");
    expect(selectOf("post_merge", "model").value).toBe("sonnet");
  });

  it("keeps an unsaved edit across a refresh, and follows coord on the untouched field", async () => {
    await renderPanel();
    fireEvent.change(selectOf("post_merge", "model"), {
      target: { value: "opus" },
    });
    // Another writer changes effort meanwhile.
    routes.launchSettings = () => {
      const body = launchSettingsBody() as {
        settings: Record<string, unknown>[];
      };
      body.settings[0] = { ...body.settings[0], effort: "low" };
      return { body };
    };
    await act(async () => {
      fireEvent.click(screen.getByTestId("spawn-launch-refresh"));
    });
    await settle();
    expect(selectOf("post_merge", "model").value).toBe("opus");
    expect(selectOf("post_merge", "effort").value).toBe("low");
    await saveRow("post_merge");
    expect(puts()[0]?.body).toEqual({ model: "opus", effort: "low" });
  });

  it("a field set back to coord's value follows coord again across a refresh", async () => {
    await renderPanel();
    const model = selectOf("post_merge", "model");
    fireEvent.change(model, { target: { value: "opus" } });
    fireEvent.change(selectOf("post_merge", "model"), {
      target: { value: "sonnet" },
    });
    routes.launchSettings = () => {
      const body = launchSettingsBody() as {
        settings: Record<string, unknown>[];
      };
      body.settings[0] = { ...body.settings[0], model: "haiku" };
      return { body };
    };
    await act(async () => {
      fireEvent.click(screen.getByTestId("spawn-launch-refresh"));
    });
    await settle();
    expect(selectOf("post_merge", "model").value).toBe("haiku");
    expect(
      (
        within(row("post_merge")).getByTestId(
          "spawn-launch-save"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("a settled save clears the draft: a refused one shows coord's value again", async () => {
    routes.putLaunchSetting = () => ({ status: 422, body: { detail: "no" } });
    await renderPanel();
    fireEvent.change(selectOf("vet_plan", "effort"), {
      target: { value: "max" },
    });
    await saveRow("vet_plan");
    expect(selectOf("vet_plan", "effort").value).toBe("");
    expect(
      (
        within(row("vet_plan")).getByTestId(
          "spawn-launch-save"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("is read-only for a member who cannot edit", async () => {
    routes.launchSettings = () => ({
      body: { ...(launchSettingsBody() as object), can_edit: false },
    });
    await renderPanel();
    expect(screen.getByTestId("spawn-launch-readonly")).toBeTruthy();
    expect(selectOf("post_merge", "model").disabled).toBe(true);
    expect(screen.queryByTestId("spawn-launch-save")).toBeNull();
  });
});
