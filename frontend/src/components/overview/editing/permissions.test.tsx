import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Edit controls come from the server's answer for the project on screen —
 * and from nothing else. Until it has answered, and if it fails, nothing is
 * editable: showing a control is an authorisation claim.
 */

const api = vi.hoisted(() => ({ fetchCatalog: vi.fn() }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, ...api };
});

import { EditGate, OverviewPermissionsProvider } from "./permissions";

function catalog(canEdit: Record<string, boolean>) {
  return {
    tenant_id: "t1",
    resources: Object.entries(canEdit).map(([name, can_edit]) => ({
      name,
      path: name,
      title: name,
      description: "",
      operations: ["get", "update"],
      can_edit,
      schemas: {},
    })),
  };
}

function renderGate(hold = false) {
  return render(
    <OverviewPermissionsProvider tenantId="t1" hold={hold}>
      <EditGate resource="intent_documents">
        <button type="button">Edit</button>
      </EditGate>
    </OverviewPermissionsProvider>
  );
}

beforeEach(() => vi.resetAllMocks());

describe("EditGate", () => {
  it("shows the control when the server says this viewer may edit", async () => {
    api.fetchCatalog.mockResolvedValue(catalog({ intent_documents: true }));
    renderGate();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy()
    );
  });

  it("renders nothing — not a disabled control — when they may not", async () => {
    api.fetchCatalog.mockResolvedValue(catalog({ intent_documents: false }));
    renderGate();
    await waitFor(() => expect(api.fetchCatalog).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing while the answer is unknown, or when it failed", async () => {
    let resolve!: (v: unknown) => void;
    api.fetchCatalog.mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = renderGate();
    expect(screen.queryByRole("button")).toBeNull();
    resolve(catalog({ intent_documents: true }));
    unmount();

    api.fetchCatalog.mockRejectedValue(new Error("GET failed: 502"));
    renderGate();
    await waitFor(() => expect(api.fetchCatalog).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not ask before the project is known", () => {
    renderGate(true);
    expect(api.fetchCatalog).not.toHaveBeenCalled();
  });

  it("treats a resource the catalog does not list as not editable", async () => {
    api.fetchCatalog.mockResolvedValue(catalog({ estimates: true }));
    renderGate();
    await waitFor(() => expect(api.fetchCatalog).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });
});
