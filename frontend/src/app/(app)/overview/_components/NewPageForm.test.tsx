import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ createResource: vi.fn() }));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { ResourceError } from "@/components/overview/editing/api";
import { NewPageForm } from "./NewPageForm";

function form(onCreated = vi.fn()) {
  render(
    <NewPageForm
      kind="wiki"
      initialTitle="Risks"
      onCreated={onCreated}
      uiBridgeId="t.new"
    />
  );
  return onCreated;
}

describe("NewPageForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the page it names and hands it on", async () => {
    const created = { id: "p9", slug: "risks", kind: "wiki", title: "Risks" };
    api.createResource.mockResolvedValue(created);
    const onCreated = form();
    fireEvent.click(screen.getByRole("button", { name: "Create wiki page" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(api.createResource).toHaveBeenCalledWith(
      "pages",
      { kind: "wiki", title: "Risks", body_md: "" },
      expect.any(String)
    );
  });

  it("refuses a name with no letter or number before asking", () => {
    form();
    fireEvent.change(screen.getByLabelText("Name of the new wiki page"), {
      target: { value: "***" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create wiki page" }));
    expect(screen.getByRole("alert").textContent).toMatch(
      /at least one letter/
    );
    expect(api.createResource).not.toHaveBeenCalled();
  });

  it("keeps its key after a lost attempt, so creating again is answered, not repeated", async () => {
    api.createResource.mockRejectedValueOnce(new Error("Request timeout"));
    form();
    fireEvent.click(screen.getByRole("button", { name: "Create wiki page" }));
    expect(await screen.findByText("Request timeout")).toBeTruthy();
    api.createResource.mockResolvedValueOnce({ id: "p9" });
    fireEvent.click(screen.getByRole("button", { name: "Create wiki page" }));
    await waitFor(() => expect(api.createResource).toHaveBeenCalledTimes(2));
    const keys = api.createResource.mock.calls.map((c) => c[2]);
    expect(keys[0]).toBe(keys[1]);
  });

  it("shows the server's reason, and tries a new key next time", async () => {
    api.createResource.mockRejectedValueOnce(
      new ResourceError(
        409,
        "name_taken",
        "There is already a wiki called that."
      )
    );
    form();
    fireEvent.click(screen.getByRole("button", { name: "Create wiki page" }));
    expect(
      await screen.findByText("There is already a wiki called that.")
    ).toBeTruthy();
    api.createResource.mockResolvedValueOnce({ id: "p9" });
    fireEvent.click(screen.getByRole("button", { name: "Create wiki page" }));
    await waitFor(() => expect(api.createResource).toHaveBeenCalledTimes(2));
    const keys = api.createResource.mock.calls.map((c) => c[2]);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
