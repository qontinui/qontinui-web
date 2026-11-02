import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The trap this control sits on: `PUT /overview/settings` replaces every field
 * and defaults what is omitted. So these assert the WHOLE body, spelled out,
 * and run through the real `saveBaseCurrency` and the real permission provider;
 * only the network calls are mocked.
 */

const api = vi.hoisted(() => ({
  fetchCatalog: vi.fn(),
  writeSettings: vi.fn(),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
const read = vi.hoisted(() => ({ fetchSettings: vi.fn() }));
vi.mock("../../_lib/estimate-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...read,
}));

import { ResourceError } from "@/components/overview/editing/api";
import { OverviewPermissionsProvider } from "@/components/overview/editing/permissions";
import { ACTIVE_TENANT_STORAGE_KEY } from "@/services/http-client";
import { BaseCurrency } from "./BaseCurrency";

/** Nothing here is a default: a field dropped or reset cannot pass unnoticed.
 *  `editing_roles` is served, and is not on the client's own type. */
const STORED = {
  base_currency: "USD",
  fx_rates: { CHF: "0.91", GBP: { rate: "0.79", as_of: "2026-10-01" } },
  labour_billing: "day_rates",
  hours_per_day: "7.50",
  working_day_factor: "0.8500",
  first_value_date: "2026-03-01",
  editing_roles: ["admin", "operator"],
  version: 7,
  is_default: false,
  updated_at: "2026-10-30T10:00:00Z",
  updated_by: "someone@example.com",
};

const READ_MOVED =
  "Another tab has selected a different project, so this page can't show this one's base currency. Reload this page to see the project that is selected now.";

function catalog(canEdit: boolean | "absent") {
  return {
    tenant_id: "t1",
    resources:
      canEdit === "absent"
        ? []
        : [
            {
              name: "settings",
              path: "settings",
              title: "Project settings",
              description: "",
              operations: ["get", "update"],
              can_edit: canEdit,
              schemas: {},
            },
          ],
  };
}

function show({ hold = false, onChanged = vi.fn() } = {}) {
  render(
    <OverviewPermissionsProvider tenantId="t1" hold={false}>
      <BaseCurrency projectId="t1" hold={hold} onChanged={onChanged} />
    </OverviewPermissionsProvider>
  );
  return onChanged;
}

async function openEditor() {
  fireEvent.click(await screen.findByRole("button", { name: "Change" }));
  return screen.getByRole("textbox", { name: "Base currency" });
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

async function value(code: string) {
  await waitFor(() =>
    expect(
      document.querySelector(
        '[data-ui-bridge-id="overview.costs.base-currency.value"]'
      )?.textContent
    ).toBe(code)
  );
}

describe("BaseCurrency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t1");
    read.fetchSettings.mockResolvedValue(STORED);
    api.fetchCatalog.mockResolvedValue(catalog(true));
  });

  it("sends every other setting back unchanged, and the version it read", async () => {
    api.writeSettings.mockResolvedValue({
      ...STORED,
      base_currency: "EUR",
      version: 8,
    });
    const onChanged = show();
    type(await openEditor(), "EUR");
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    expect(api.writeSettings).toHaveBeenCalledTimes(1);
    expect(api.writeSettings.mock.calls[0]![0]).toStrictEqual({
      base_currency: "EUR",
      fx_rates: { CHF: "0.91", GBP: { rate: "0.79", as_of: "2026-10-01" } },
      labour_billing: "day_rates",
      hours_per_day: "7.50",
      working_day_factor: "0.8500",
      first_value_date: "2026-03-01",
      expected_version: 7,
    });
    await value("EUR");
    expect(screen.getByRole("status").textContent).toBe(
      "Base currency set to EUR. Nothing was converted."
    );
  });

  it("leaves editing_roles out of the write, so the stored set is left alone", async () => {
    api.writeSettings.mockResolvedValue({ ...STORED, base_currency: "EUR" });
    const onChanged = show();
    type(await openEditor(), "EUR");
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.writeSettings.mock.calls[0]![0]).not.toHaveProperty(
      "editing_roles"
    );
  });

  it("makes a project's first save on the defaults, at version 0", async () => {
    read.fetchSettings.mockResolvedValue({
      base_currency: "USD",
      fx_rates: {},
      labour_billing: "unbilled",
      hours_per_day: "8",
      working_day_factor: "1.0",
      first_value_date: null,
      editing_roles: ["admin"],
      version: 0,
      is_default: true,
      updated_at: null,
      updated_by: null,
    });
    api.writeSettings.mockResolvedValue({
      ...STORED,
      base_currency: "EUR",
      version: 1,
    });
    const onChanged = show();
    type(await openEditor(), "EUR");
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.writeSettings.mock.calls[0]![0]).toStrictEqual({
      base_currency: "EUR",
      fx_rates: {},
      labour_billing: "unbilled",
      hours_per_day: "8",
      working_day_factor: "1.0",
      first_value_date: null,
      expected_version: 0,
    });
  });

  it("builds a second save on the version the first one returned", async () => {
    api.writeSettings
      .mockResolvedValueOnce({ ...STORED, base_currency: "EUR", version: 8 })
      .mockResolvedValueOnce({ ...STORED, base_currency: "GBP", version: 9 });
    const onChanged = show();
    type(await openEditor(), "EUR");
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    type(await openEditor(), "GBP");
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(api.writeSettings.mock.calls[1]![0]).toMatchObject({
      base_currency: "GBP",
      expected_version: 8,
    });
  });

  it("normalises what was typed", async () => {
    api.writeSettings.mockResolvedValue({ ...STORED, base_currency: "EUR" });
    const onChanged = show();
    type(await openEditor(), "eur");
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.writeSettings.mock.calls[0]![0].base_currency).toBe("EUR");
  });

  it("takes a code pasted with spaces round it", async () => {
    api.writeSettings.mockResolvedValue({ ...STORED, base_currency: "EUR" });
    const onChanged = show();
    const input = await openEditor();
    // The browser applies a maxLength to a paste, so the attribute must be gone.
    expect(input.hasAttribute("maxlength")).toBe(false);
    type(input, " EUR ");
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.writeSettings.mock.calls[0]![0].base_currency).toBe("EUR");
  });

  it.each([
    ["", "Enter a currency code such as USD or EUR."],
    ["E", "“E” is not a currency. Use a code such as USD or EUR."],
    ["EU1", "“EU1” is not a currency. Use a code such as USD or EUR."],
    ["€€€", "“€€€” is not a currency. Use a code such as USD or EUR."],
    ["EURO", "“EURO” is not a currency. Use a code such as USD or EUR."],
    // Upper-cases to the three ASCII letters "SSA": judged as typed, not after.
    ["ßa", "“ßa” is not a currency. Use a code such as USD or EUR."],
  ])("refuses %j without asking the server", async (typed, message) => {
    show();
    const input = await openEditor();
    type(input, typed);
    clickSave();
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(api.writeSettings).not.toHaveBeenCalled();
    // The complaint goes as soon as what it complains about is changed.
    type(input, "EUR");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("the project a save would land in", () => {
    it("refuses when another tab has selected a different project", async () => {
      const onChanged = show();
      type(await openEditor(), "EUR");
      localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t2");
      clickSave();
      expect(screen.getByRole("alert").textContent).toBe(
        "This page's project is no longer the selected one, so saving here would change a different project's settings. Nothing was saved. Reload this page, check which project it shows, and select the one you meant before saving."
      );
      expect(api.writeSettings).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("refuses when no selection can be read", async () => {
      show();
      type(await openEditor(), "EUR");
      localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
      clickSave();
      expect(screen.getByRole("alert").textContent).toBe(
        "This browser isn't reporting which project is selected, so a save could land in the wrong one. Nothing was saved. Reload this page and try again; if this keeps happening, allow this site to store data in your browser."
      );
      expect(api.writeSettings).not.toHaveBeenCalled();
    });

    it("discards a read taken while another project was selected, so its settings can't be saved here later", async () => {
      read.fetchSettings.mockImplementationOnce(async () => {
        localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t2");
        return { ...STORED, base_currency: "GBP", version: 7 };
      });
      show();
      expect(await screen.findByText(READ_MOVED)).toBeTruthy();
      expect(document.body.textContent).not.toContain("GBP");
      expect(document.body.textContent).not.toContain("few minutes");
      localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t1");
      expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await value("USD");
    });

    it("does not read at all while another project is selected", async () => {
      localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t2");
      show();
      expect(await screen.findByText(READ_MOVED)).toBeTruthy();
      expect(read.fetchSettings).not.toHaveBeenCalled();
    });

    it("shows the home project's value when the selection is unreadable", async () => {
      localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
      show();
      await value("USD");
    });

    it("does not read another project's settings in as this one's after a 409", async () => {
      api.writeSettings.mockImplementationOnce(async () => {
        localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t2");
        throw new ResourceError(409, "version_conflict", "Somebody saved");
      });
      show();
      type(await openEditor(), "EUR");
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "This page's project is no longer the selected one"
        )
      );
      expect(read.fetchSettings).toHaveBeenCalledTimes(1);
    });

    it("refuses when the server answers for another project than the selected one", async () => {
      // A member removed from the selected project: the backend degrades the
      // header to their home project, and the selection still reads as this one.
      const onChanged = show();
      type(await openEditor(), "EUR");
      api.fetchCatalog.mockResolvedValue({
        ...catalog(true),
        tenant_id: "home",
      });
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "This page's project is no longer the selected one"
        )
      );
      expect(api.writeSettings).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("refuses when the selection moves while the server is being asked", async () => {
      show();
      type(await openEditor(), "EUR");
      api.fetchCatalog.mockImplementation(async () => {
        localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t2");
        return catalog(true);
      });
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "This page's project is no longer the selected one"
        )
      );
      expect(api.writeSettings).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });

    it("saves nothing when it can't find out which project the server answers for", async () => {
      show();
      const input = await openEditor();
      type(input, "EUR");
      api.fetchCatalog.mockRejectedValue(new Error("GET failed: 502"));
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "Couldn't confirm which project this would save to. Nothing was saved. Try again in a moment."
        )
      );
      expect(api.writeSettings).not.toHaveBeenCalled();
      // Not stuck on "Saving…": the editor can try again.
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });

    it("does not adopt a re-read after a 409 when the server answers for another project", async () => {
      api.writeSettings.mockImplementationOnce(async () => {
        api.fetchCatalog.mockResolvedValue({
          ...catalog(true),
          tenant_id: "home",
        });
        throw new ResourceError(409, "version_conflict", "Somebody saved");
      });
      show();
      type(await openEditor(), "EUR");
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toContain(
          "This page's project is no longer the selected one"
        )
      );
      expect(read.fetchSettings).toHaveBeenCalledTimes(1);
    });
  });

  it("does not mark a valid code invalid when the refusal is not about the code", async () => {
    api.writeSettings.mockRejectedValueOnce(new ResourceError(403, null, "no"));
    show();
    const input = await openEditor();
    type(input, "EUR");
    clickSave();
    await screen.findByRole("alert");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("says when the value is the default nobody has chosen, and lets it be chosen as is", async () => {
    read.fetchSettings.mockResolvedValue({
      ...STORED,
      is_default: true,
      version: 0,
    });
    api.writeSettings.mockResolvedValue({ ...STORED, version: 1 });
    const onChanged = show();
    expect(await screen.findByText("Default, not chosen yet")).toBeTruthy();
    await openEditor();
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(api.writeSettings.mock.calls[0]![0]).toMatchObject({
      base_currency: "USD",
      expected_version: 0,
    });
    expect(screen.queryByText("Default, not chosen yet")).toBeNull();
  });

  it("does not call a chosen value the default", async () => {
    show();
    await value("USD");
    expect(screen.queryByText("Default, not chosen yet")).toBeNull();
  });

  it("has nothing to save until the code differs from the stored one", async () => {
    show();
    const input = await openEditor();
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    type(input, "usd");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    type(input, "EUR");
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it("writes once however often Save is pressed while one is in flight", async () => {
    let finish!: (v: unknown) => void;
    api.writeSettings.mockReturnValue(new Promise((r) => (finish = r)));
    const onChanged = show();
    const input = (await openEditor()) as HTMLInputElement;
    type(input, "EUR");
    const save = screen.getByRole("button", { name: "Save" });
    clickSave();
    await waitFor(() => expect(save.textContent).toBe("Saving…"));
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // Read-only, not disabled: disabling would drop keyboard focus to the body.
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    fireEvent.submit(save.closest("form")!);
    expect(api.writeSettings).toHaveBeenCalledTimes(1);
    finish({ ...STORED, base_currency: "EUR", version: 8 });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("on a 409 saves nothing more, re-reads, and builds the retry on what is stored now", async () => {
    const theirs = {
      ...STORED,
      base_currency: "CHF",
      fx_rates: { JPY: "150" },
      hours_per_day: "6.00",
      version: 9,
    };
    api.writeSettings.mockRejectedValueOnce(
      new ResourceError(409, "version_conflict", "Somebody else saved this")
    );
    const onChanged = show();
    const input = await openEditor();
    type(input, "EUR");
    read.fetchSettings.mockResolvedValue(theirs);
    clickSave();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Somebody else changed this project's settings first, and the base currency is now CHF. Nothing was saved. Save again to set it to EUR."
      )
    );
    expect(api.writeSettings).toHaveBeenCalledTimes(1);
    // Their CHF is the stored value now, so the rest of the page must re-read.
    expect(onChanged).toHaveBeenCalledTimes(1);
    // What was typed survives, and only the editor's own click writes again.
    expect((input as HTMLInputElement).value).toBe("EUR");

    api.writeSettings.mockResolvedValueOnce({
      ...theirs,
      base_currency: "EUR",
      version: 10,
    });
    clickSave();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(api.writeSettings.mock.calls[1]![0]).toStrictEqual({
      base_currency: "EUR",
      fx_rates: { JPY: "150" },
      labour_billing: "day_rates",
      hours_per_day: "6.00",
      working_day_factor: "0.8500",
      first_value_date: "2026-03-01",
      expected_version: 9,
    });
  });

  it("on a 409 that only moved other settings, says the currency is still what it was", async () => {
    api.writeSettings.mockRejectedValueOnce(
      new ResourceError(409, "version_conflict", "Somebody else saved this")
    );
    const onChanged = show();
    type(await openEditor(), "EUR");
    read.fetchSettings.mockResolvedValue({ ...STORED, version: 8 });
    clickSave();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Somebody else changed this project's settings first, and the base currency is still USD. Nothing was saved. Save again to set it to EUR."
      )
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("on a 409 whose re-read already holds the wanted code, says so and stops", async () => {
    api.writeSettings.mockRejectedValueOnce(
      new ResourceError(409, "version_conflict", "Somebody else saved this")
    );
    const onChanged = show();
    type(await openEditor(), "EUR");
    read.fetchSettings.mockResolvedValue({
      ...STORED,
      base_currency: "EUR",
      version: 8,
    });
    clickSave();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "The base currency is already EUR."
      )
    );
    await value("EUR");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(api.writeSettings).toHaveBeenCalledTimes(1);
  });

  it("on a 409 whose re-read fails, says nothing was saved, offers no form to save stale settings from, and can read again", async () => {
    api.writeSettings.mockRejectedValueOnce(
      new ResourceError(409, "version_conflict", "Somebody else saved this")
    );
    const onChanged = show();
    type(await openEditor(), "EUR");
    read.fetchSettings.mockRejectedValue(new Error("GET failed: 502"));
    clickSave();
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Base currency" })
      ).toBeNull()
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(document.body.textContent).toContain("GET failed: 502");
    expect(screen.getByRole("alert").textContent).toBe(
      "Somebody else changed this project's settings first. Nothing was saved, and the current settings could not be read."
    );
    expect(onChanged).not.toHaveBeenCalled();

    read.fetchSettings.mockResolvedValue({
      ...STORED,
      base_currency: "CHF",
      version: 9,
    });
    const again = screen.getByRole("button", { name: "Try again" });
    expect(document.activeElement).toBe(again);
    fireEvent.click(again);
    await value("CHF");
    // The 409 proved the settings moved: the rest of the page must re-read now.
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.writeSettings).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, null, "You can read this project's overview but not change it."],
    [422, "validation", "base_currency: must be a code"],
  ])(
    "on a %i keeps the form open and says why, without re-reading",
    async (status, code, message) => {
      api.writeSettings.mockRejectedValueOnce(
        new ResourceError(status, code, "base_currency: must be a code")
      );
      const onChanged = show();
      const input = await openEditor();
      type(input, "EUR");
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(message)
      );
      expect((input as HTMLInputElement).value).toBe("EUR");
      expect(onChanged).not.toHaveBeenCalled();
      expect(read.fetchSettings).toHaveBeenCalledTimes(1);
    }
  );

  describe("a save with no clear answer may have landed", () => {
    const LOST = new ResourceError(503, null, "unavailable");

    it("reports success when the re-read shows it did land", async () => {
      api.writeSettings.mockRejectedValueOnce(LOST);
      const onChanged = show();
      type(await openEditor(), "EUR");
      read.fetchSettings.mockResolvedValue({
        ...STORED,
        base_currency: "EUR",
        version: 8,
      });
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe(
          "Base currency set to EUR. Nothing was converted."
        )
      );
      await value("EUR");
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("does not claim a choice of the default landed when the re-read still shows the default", async () => {
      const DEFAULTS = { ...STORED, is_default: true, version: 0 };
      read.fetchSettings.mockResolvedValue(DEFAULTS);
      api.writeSettings.mockRejectedValueOnce(LOST);
      const onChanged = show();
      await openEditor();
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "The service that stores this isn't responding. Your text is kept here; try again in a few minutes."
        )
      );
      expect(screen.queryByRole("status")).toBeNull();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("reports the failure and keeps the form when the re-read shows it did not", async () => {
      api.writeSettings.mockRejectedValueOnce(LOST);
      const onChanged = show();
      const input = await openEditor();
      type(input, "EUR");
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "The service that stores this isn't responding. Your text is kept here; try again in a few minutes."
        )
      );
      expect(read.fetchSettings).toHaveBeenCalledTimes(2);
      expect((input as HTMLInputElement).value).toBe("EUR");
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("names the new value when the re-read shows somebody else moved it", async () => {
      api.writeSettings.mockRejectedValueOnce(LOST);
      const onChanged = show();
      type(await openEditor(), "EUR");
      read.fetchSettings.mockResolvedValue({
        ...STORED,
        base_currency: "CHF",
        version: 8,
      });
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "The service that stores this isn't responding. Your text is kept here; try again in a few minutes. Somebody else has changed the base currency to CHF meanwhile."
        )
      );
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("treats a dropped connection the same way", async () => {
      api.writeSettings.mockRejectedValueOnce(new Error("Network error"));
      show();
      type(await openEditor(), "EUR");
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe("Network error")
      );
      expect(read.fetchSettings).toHaveBeenCalledTimes(2);
    });

    it("says the outcome is unknown when the re-read fails too, leaves no stale value to Cancel back to, and re-reads", async () => {
      api.writeSettings.mockRejectedValueOnce(LOST);
      const onChanged = show();
      type(await openEditor(), "EUR");
      read.fetchSettings.mockRejectedValue(new Error("GET failed: 502"));
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "The save got no clear answer and the current settings could not be read, so whether it was saved is not known."
        )
      );
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(document.body.textContent).not.toContain("USD");
      expect(onChanged).not.toHaveBeenCalled();

      read.fetchSettings.mockResolvedValue({
        ...STORED,
        base_currency: "EUR",
        version: 8,
      });
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await value("EUR");
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    });

    it("does not adopt a re-read answered by another project", async () => {
      api.writeSettings.mockImplementationOnce(async () => {
        localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, "t2");
        throw LOST;
      });
      const onChanged = show();
      type(await openEditor(), "EUR");
      clickSave();
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "The save got no clear answer, so it may or may not have landed in this project, and this page's project is no longer the selected one, so it can't be checked from here. Reload this page, select this project and check its base currency before saving again."
        )
      );
      expect(read.fetchSettings).toHaveBeenCalledTimes(1);
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  it("Cancel closes the form and writes nothing", async () => {
    show();
    type(await openEditor(), "EUR");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await value("USD");
    expect(api.writeSettings).not.toHaveBeenCalled();
  });

  it("says what the setting does and that it converts nothing", async () => {
    show();
    await value("USD");
    expect(document.body.textContent).toContain(
      "The default currency for a new recurring cost that names none; a one-off cost always names its own."
    );
    expect(document.body.textContent).toContain("converts nothing");
  });

  describe("who may edit comes from the served answer", () => {
    it.each([
      ["says they may not", () => Promise.resolve(catalog(false))],
      ["does not list settings", () => Promise.resolve(catalog("absent"))],
      ["failed", () => Promise.reject(new Error("GET failed: 502"))],
    ])(
      "a reader sees the value and no control when the catalog %s",
      async (_, answer) => {
        api.fetchCatalog.mockImplementation(answer);
        show();
        await value("USD");
        await waitFor(() => expect(api.fetchCatalog).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r));
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("textbox")).toBeNull();
      }
    );

    it("no control while the catalog has not answered", async () => {
      api.fetchCatalog.mockReturnValue(new Promise(() => {}));
      show();
      await value("USD");
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  it("reads nothing until the project is known, then shows a failed read as a failure", async () => {
    read.fetchSettings.mockRejectedValue(new Error("GET failed: 500"));
    const { rerender } = render(
      <BaseCurrency projectId="t1" hold onChanged={vi.fn()} />
    );
    expect(read.fetchSettings).not.toHaveBeenCalled();
    rerender(<BaseCurrency projectId="t1" hold={false} onChanged={vi.fn()} />);
    await waitFor(() =>
      expect(document.body.textContent).toContain("GET failed: 500")
    );
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(document.body.textContent).not.toContain("USD");
  });
});
