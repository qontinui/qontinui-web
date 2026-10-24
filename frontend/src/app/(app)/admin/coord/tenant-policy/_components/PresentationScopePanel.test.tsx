/**
 * The presentation scope form on /admin/coord/tenant-policy (plan
 * `2026-10-23-console-presentation-spaces` D3.3: both lists are tenant data,
 * "editable in operator mode only").
 *
 * The REAL panel over a real scope store (`createPresentationScopeStore`)
 * whose read is the test's; the save goes through the real client module,
 * mocked at its export, and fails with the real `BackendError` the client
 * throws. Enumerated: an admin, a member, a staged save, a refusal (403), a
 * conflict (409), an unreadable scope, owners coord could not list, and the
 * panel in presentation mode.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationScopeRecord,
  PresentationScopeWrite,
} from "@/lib/api/presentationScope";

const api = vi.hoisted(() => ({
  savePresentationScope: vi.fn(),
  fetchPresentationScope: vi.fn(),
}));
vi.mock("@/lib/api/presentationScope", () => api);

import {
  FixedPresentationMode,
  createPresentationScopeStore,
  type PresentationScopeStore,
} from "@/components/presentation";
import { BackendError } from "@/lib/errors/backend-error-message";
import { PresentationScopePanel } from "./PresentationScopePanel";

const TENANT = "00000000-0000-0000-0000-00000000000a";

function record(
  over: Partial<PresentationScopeRecord> = {},
  configured: Partial<PresentationScopeRecord["configured"]> = {}
): PresentationScopeRecord {
  return {
    tenant_id: TENANT,
    first_party_owners: ["qontinui"],
    first_party_owners_source: "configured",
    first_party_owners_unknown_reason: null,
    // The effective terms: the stored one PLUS the viewer's other project.
    confidential_terms: ["Acme Corp", "Partner Portal"],
    configured: {
      first_party_owners: ["qontinui"],
      confidential_terms: ["Acme Corp"],
      version: 3,
      updated_at: "2026-10-23T12:00:00Z",
      updated_by: "admin@example.test",
      ...configured,
    },
    defaults: {
      registered_repo_owners: ["qontinui"],
      registered_repo_owners_unknown_reason: null,
      viewer_other_tenant_names: ["Partner Portal"],
    },
    can_edit: true,
    ...over,
  };
}

function backendError(status: number, sentence: string): BackendError {
  return new BackendError({ kind: "unstructured", sentence }, status);
}

let load: ReturnType<typeof vi.fn>;
let store: PresentationScopeStore;

function renderPanel(presenting?: boolean) {
  const panel = <PresentationScopePanel store={store} />;
  return render(
    presenting === undefined ? (
      panel
    ) : (
      <FixedPresentationMode presenting={presenting}>
        {panel}
      </FixedPresentationMode>
    )
  );
}

beforeEach(() => {
  api.savePresentationScope.mockReset();
  load = vi.fn(async () => record());
  store = createPresentationScopeStore({
    load,
    readSelection: () => TENANT,
    watchStorage: false,
  });
});

describe("PresentationScopePanel — reading", () => {
  it("reads the scope itself and shows the lists in force", async () => {
    renderPanel();
    const inForce = await screen.findByTestId("presentation-scope-in-force");
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("presentation-scope-owners")).toHaveTextContent(
      "qontinui"
    );
    expect(screen.getByTestId("presentation-scope-terms")).toHaveTextContent(
      "Acme Corp"
    );
    expect(inForce).toHaveTextContent("(configured for this project)");
    expect(
      screen.getByTestId("presentation-scope-viewer-names")
    ).toHaveTextContent("Partner Portal");
  });

  it("labels owners coord could not list as UNKNOWN, with why", async () => {
    load.mockResolvedValue(
      record(
        {
          first_party_owners: null,
          first_party_owners_source: "registered_repos",
          first_party_owners_unknown_reason: "coord_unreachable",
        },
        { first_party_owners: null }
      )
    );
    renderPanel();
    expect(
      await screen.findByTestId("presentation-scope-owners-unknown")
    ).toHaveTextContent("UNKNOWN — coord could not be reached");
  });

  it("says the scope is unknown when it cannot be read, and offers no form", async () => {
    load.mockRejectedValue(new Error("HTTP 502"));
    renderPanel();
    expect(
      await screen.findByTestId("presentation-scope-unknown")
    ).toHaveTextContent("could not be read (HTTP 502)");
    expect(screen.queryByTestId("presentation-scope-form")).toBeNull();
  });
});

describe("PresentationScopePanel — who may edit", () => {
  it("offers a member no form, and says why", async () => {
    load.mockResolvedValue(record({ can_edit: false }));
    renderPanel();
    expect(
      await screen.findByTestId("presentation-scope-readonly")
    ).toHaveTextContent("not an admin of this project");
    expect(screen.queryByTestId("presentation-scope-form")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("is never part of a presentation", async () => {
    renderPanel(true);
    // Let the read land before asserting the absence.
    await waitFor(() => expect(load).toHaveBeenCalledTimes(0));
    expect(screen.queryByTestId("presentation-scope-policy")).toBeNull();
    expect(document.body.innerHTML).not.toContain("Partner Portal");
  });

  it("is there for the operator", async () => {
    renderPanel(false);
    expect(
      await screen.findByTestId("presentation-scope-form")
    ).toBeInTheDocument();
  });
});

describe("PresentationScopePanel — the form", () => {
  async function terms(): Promise<HTMLTextAreaElement> {
    return (await screen.findByTestId(
      "presentation-scope-terms-input"
    )) as HTMLTextAreaElement;
  }

  it("is seeded from what is STORED, never from the effective lists", async () => {
    renderPanel();
    // The effective terms add the viewer's other project; the stored half does not.
    expect((await terms()).value).toBe("Acme Corp");
    expect(screen.getByTestId("presentation-scope-form")).toHaveTextContent(
      "(version 3)"
    );
  });

  it("offers no save until the edit changes what is stored", async () => {
    renderPanel();
    const input = await terms();
    const save = screen.getByTestId("presentation-scope-save");
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "  Acme Corp  " } });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "Acme Corp\nGlobex" } });
    expect(save).toBeEnabled();
  });

  it("saves against the stored version, and the answer is in force in the tab at once", async () => {
    const saved = record(
      { confidential_terms: ["Acme Corp", "Globex", "Partner Portal"] },
      { confidential_terms: ["Acme Corp", "Globex"], version: 4 }
    );
    api.savePresentationScope.mockResolvedValue(saved);
    renderPanel();
    fireEvent.change(await terms(), {
      target: { value: "Acme Corp\n\n  Globex " },
    });
    fireEvent.click(screen.getByTestId("presentation-scope-save"));

    await screen.findByTestId("presentation-scope-saved");
    expect(api.savePresentationScope).toHaveBeenCalledWith<
      [PresentationScopeWrite]
    >({
      first_party_owners: ["qontinui"],
      confidential_terms: ["Acme Corp", "Globex"],
      expected_version: 3,
    });
    expect(store.getSnapshot().record).toBe(saved);
    expect(screen.getByTestId("presentation-scope-terms")).toHaveTextContent(
      "Globex"
    );
    // Accepted, not re-read.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("saves null owners when the registered repositories' owners are chosen", async () => {
    api.savePresentationScope.mockResolvedValue(
      record({}, { first_party_owners: null, version: 4 })
    );
    renderPanel();
    fireEvent.click(
      await screen.findByTestId("presentation-scope-owners-registered")
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    await screen.findByTestId("presentation-scope-saved");
    expect(api.savePresentationScope.mock.calls[0][0]).toMatchObject({
      first_party_owners: null,
      expected_version: 3,
    });
  });

  it("re-reads on a conflict and keeps the edit, saving against the new version next", async () => {
    api.savePresentationScope.mockRejectedValueOnce(
      backendError(409, "The presentation scope changed since it was read.")
    );
    renderPanel();
    fireEvent.change(await terms(), {
      target: { value: "Acme Corp\nGlobex" },
    });
    // Someone else saved version 4 meanwhile.
    load.mockResolvedValue(
      record({}, { confidential_terms: ["Initech"], version: 4 })
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));

    expect(
      await screen.findByTestId("presentation-scope-conflict")
    ).toBeInTheDocument();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("presentation-scope-form")).toHaveTextContent(
        "(version 4)"
      )
    );
    expect((await terms()).value).toBe("Acme Corp\nGlobex");

    api.savePresentationScope.mockResolvedValueOnce(
      record({}, { confidential_terms: ["Acme Corp", "Globex"], version: 5 })
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    await screen.findByTestId("presentation-scope-saved");
    expect(api.savePresentationScope.mock.calls[1][0]).toMatchObject({
      expected_version: 4,
    });
  });

  it("says a refused save was refused, and changes nothing", async () => {
    api.savePresentationScope.mockRejectedValue(
      backendError(403, "not_coord_tenant_admin")
    );
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    expect(
      await screen.findByTestId("presentation-scope-refused")
    ).toHaveTextContent("only an admin of this project");
    expect(store.getSnapshot().record?.configured.version).toBe(3);
  });

  it("names the backend's reason for an invalid list", async () => {
    api.savePresentationScope.mockRejectedValue(
      backendError(
        422,
        "'not an owner' is not a GitHub user or organization name"
      )
    );
    renderPanel();
    fireEvent.click(
      await screen.findByTestId("presentation-scope-owners-list")
    );
    fireEvent.change(screen.getByTestId("presentation-scope-owners-input"), {
      target: { value: "not an owner" },
    });
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    expect(
      await screen.findByTestId("presentation-scope-refused")
    ).toHaveTextContent("is not a GitHub user or organization name");
  });

  it("reverts an unsaved edit to what is stored", async () => {
    renderPanel();
    const input = await terms();
    fireEvent.change(input, { target: { value: "Globex" } });
    fireEvent.click(screen.getByTestId("presentation-scope-revert"));
    expect((await terms()).value).toBe("Acme Corp");
  });
});
