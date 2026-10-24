/**
 * The presentation scope form on /admin/coord/tenant-policy (plan
 * `2026-10-23-console-presentation-spaces` D3.3: both lists are tenant data,
 * "editable in operator mode only").
 *
 * The REAL panel over a real scope store (`createPresentationScopeStore`)
 * whose read is the test's; the save goes through the real client module,
 * mocked at its export, and fails with the real errors the client throws
 * (`BackendError`, and `PresentationScopeConflict` for a 409). Enumerated: an
 * admin, a member, a staged save, a refusal (403), a version conflict (409),
 * a project conflict (409), an UNKNOWN outcome (a timeout, a 5xx), what the
 * re-read after a save observed (in flight, read, failed, and never a read
 * sent before the save), a later read failing under a held record, a
 * re-read under an open edit, the project changing under an open edit and
 * under a save in flight, an unreadable scope, owners coord could not list,
 * and the panel in presentation mode.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationScopeRecord,
  PresentationScopeWrite,
} from "@/lib/api/presentationScope";

const api = vi.hoisted(() => ({
  savePresentationScope: vi.fn(),
  fetchPresentationScope: vi.fn(),
}));
// The real module (its error classes), with the two network calls the test's.
vi.mock("@/lib/api/presentationScope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/presentationScope")>()),
  ...api,
}));

import {
  FixedPresentationMode,
  createPresentationScopeStore,
  type PresentationScopeStore,
} from "@/components/presentation";
import { PresentationScopeConflict } from "@/lib/api/presentationScope";
import { BackendError } from "@/lib/errors/backend-error-message";
import { PresentationScopePanel } from "./PresentationScopePanel";

const TENANT = "00000000-0000-0000-0000-00000000000a";
const OTHER_TENANT = "00000000-0000-0000-0000-00000000000b";

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

function conflict(
  kind: "version" | "tenant",
  sentence = "The presentation scope changed since it was read."
): PresentationScopeConflict {
  return new PresentationScopeConflict(
    { kind: "unstructured", sentence },
    kind
  );
}

let load: ReturnType<typeof vi.fn>;
let store: PresentationScopeStore;
/** The project selection requests carry — the test switches it. */
let selection: { value: string };

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
  selection = { value: TENANT };
  store = createPresentationScopeStore({
    load,
    readSelection: () => selection.value,
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
      expected_tenant_id: TENANT,
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
    api.savePresentationScope.mockRejectedValueOnce(conflict("version"));
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

describe("PresentationScopePanel — an edit is bound to the scope it was made against", () => {
  async function terms(): Promise<HTMLTextAreaElement> {
    return (await screen.findByTestId(
      "presentation-scope-terms-input"
    )) as HTMLTextAreaElement;
  }

  it("saves against the version the edit began from, though a re-read moved it", async () => {
    renderPanel();
    fireEvent.change(await terms(), {
      target: { value: "Acme Corp\nGlobex" },
    });
    // Another admin saves version 4; the panel's own re-read brings it in
    // (its minute-by-minute refresh, or Refresh) under the open edit.
    load.mockResolvedValue(
      record({}, { confidential_terms: ["Initech"], version: 4 })
    );
    await act(async () => {
      await store.reload();
    });
    expect(screen.getByTestId("presentation-scope-form")).toHaveTextContent(
      "(version 4)"
    );
    expect(
      screen.getByTestId("presentation-scope-edited-from")
    ).toHaveTextContent("began from version 3");
    expect((await terms()).value).toBe("Acme Corp\nGlobex");

    // The save is a compare-and-set on what was EDITED: version 3, so the
    // other admin's term is not silently overwritten.
    api.savePresentationScope.mockRejectedValueOnce(conflict("version"));
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    expect(
      await screen.findByTestId("presentation-scope-conflict")
    ).toHaveTextContent("The stored scope changed after this edit began");
    expect(api.savePresentationScope.mock.calls[0][0]).toMatchObject({
      expected_version: 3,
      expected_tenant_id: TENANT,
    });

    // Told, the operator saves again: now against what was re-read.
    await waitFor(() =>
      expect(screen.queryByTestId("presentation-scope-edited-from")).toBeNull()
    );
    api.savePresentationScope.mockResolvedValueOnce(
      record({}, { confidential_terms: ["Acme Corp", "Globex"], version: 5 })
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    await screen.findByTestId("presentation-scope-saved");
    expect(api.savePresentationScope.mock.calls[1][0]).toMatchObject({
      expected_version: 4,
    });
  });

  it("never puts one project's edit into another's scope when the selection changes under it", async () => {
    // Project A at version 3, project B at version 3 too: a version check
    // alone would let A's edit through into B's row.
    const scopes: Record<string, PresentationScopeRecord> = {
      [TENANT]: record(),
      [OTHER_TENANT]: record(
        { tenant_id: OTHER_TENANT },
        { confidential_terms: ["Initech"], version: 3 }
      ),
    };
    load.mockImplementation(async () => scopes[selection.value]);
    renderPanel();
    fireEvent.change(await terms(), {
      target: { value: "Acme Corp\nGlobex" },
    });

    // Another tab switches the project: its storage event invalidates.
    selection.value = OTHER_TENANT;
    act(() => store.invalidate());
    expect(
      await screen.findByTestId("presentation-scope-set-aside")
    ).toHaveTextContent("made for another project is set aside");
    // B's own stored lists, not A's edit, and nothing to save.
    await waitFor(async () => expect((await terms()).value).toBe("Initech"));
    expect(screen.getByTestId("presentation-scope-save")).toBeDisabled();
    expect(api.savePresentationScope).not.toHaveBeenCalled();

    // Back on A, the edit is A's again, and saves into A only.
    selection.value = TENANT;
    act(() => store.invalidate());
    await waitFor(async () =>
      expect((await terms()).value).toBe("Acme Corp\nGlobex")
    );
    expect(screen.queryByTestId("presentation-scope-set-aside")).toBeNull();
    api.savePresentationScope.mockResolvedValueOnce(
      record({}, { confidential_terms: ["Acme Corp", "Globex"], version: 4 })
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    await screen.findByTestId("presentation-scope-saved");
    expect(api.savePresentationScope.mock.calls).toHaveLength(1);
    expect(api.savePresentationScope.mock.calls[0][0]).toMatchObject({
      expected_tenant_id: TENANT,
      expected_version: 3,
    });
  });

  it("discards a set-aside edit on request", async () => {
    const scopes: Record<string, PresentationScopeRecord> = {
      [TENANT]: record(),
      [OTHER_TENANT]: record({ tenant_id: OTHER_TENANT }),
    };
    load.mockImplementation(async () => scopes[selection.value]);
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    selection.value = OTHER_TENANT;
    act(() => store.invalidate());
    fireEvent.click(
      await screen.findByTestId("presentation-scope-discard-set-aside")
    );
    selection.value = TENANT;
    act(() => store.invalidate());
    await waitFor(async () => expect((await terms()).value).toBe("Acme Corp"));
  });

  it("sets the edit aside when the backend says the active project is not the one it was made for", async () => {
    // The request resolved to another project than the edit's (a membership
    // lost, a selection changed as the save was sent): refused, nothing
    // written, and the re-read shows the project requests now go to.
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    load.mockResolvedValue(record({ tenant_id: OTHER_TENANT }));
    api.savePresentationScope.mockRejectedValueOnce(conflict("tenant"));
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    expect(
      await screen.findByTestId("presentation-scope-set-aside")
    ).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    expect((await terms()).value).toBe("Acme Corp");
  });

  it("does not hold a save's answer as the scope of a project selected while it was in flight", async () => {
    let answer: (r: PresentationScopeRecord) => void = () => {};
    api.savePresentationScope.mockImplementationOnce(
      () =>
        new Promise<PresentationScopeRecord>((resolve) => {
          answer = resolve;
        })
    );
    const scopes: Record<string, PresentationScopeRecord> = {
      [TENANT]: record(),
      [OTHER_TENANT]: record(
        { tenant_id: OTHER_TENANT },
        { confidential_terms: ["Initech"] }
      ),
    };
    load.mockImplementation(async () => scopes[selection.value]);
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    // Read-only while the save is in flight.
    expect(await terms()).toBeDisabled();

    selection.value = OTHER_TENANT;
    act(() => store.invalidate());
    await act(async () => {
      answer(record({}, { confidential_terms: ["Globex"], version: 4 }));
    });
    expect(
      await screen.findByTestId("presentation-scope-saved")
    ).toHaveTextContent("The active project changed while it was saving");
    await waitFor(() =>
      expect(store.getSnapshot().record?.tenant_id).toBe(OTHER_TENANT)
    );
    expect((await terms()).value).toBe("Initech");
  });
});

describe("PresentationScopePanel — an answer naming another project", () => {
  it("is never held as this project's scope", async () => {
    // The backend writes only into the project the edit names; an answer for
    // any other contradicts that, and holding it would redact this project
    // by another's lists.
    api.savePresentationScope.mockResolvedValueOnce(
      record({ tenant_id: OTHER_TENANT }, { version: 4 })
    );
    renderPanel();
    fireEvent.change(
      await screen.findByTestId("presentation-scope-terms-input"),
      { target: { value: "Globex" } }
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    const saved = await screen.findByTestId("presentation-scope-saved");
    await waitFor(() =>
      expect(saved).toHaveTextContent("its scope, read after the save")
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().record?.tenant_id).toBe(TENANT);
  });

  it("says so when reading the project selected now fails", async () => {
    api.savePresentationScope.mockResolvedValueOnce(
      record({ tenant_id: OTHER_TENANT }, { version: 4 })
    );
    renderPanel();
    fireEvent.change(
      await screen.findByTestId("presentation-scope-terms-input"),
      { target: { value: "Globex" } }
    );
    load.mockRejectedValue(new Error("HTTP 503"));
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    const saved = await screen.findByTestId("presentation-scope-saved");
    await waitFor(() =>
      expect(saved).toHaveTextContent(
        "reading its scope failed (HTTP 503), so what it stores is UNKNOWN here"
      )
    );
    expect(saved).not.toHaveTextContent("read after the save");
  });
});

describe("PresentationScopePanel — what the re-read after a save observed", () => {
  async function terms(): Promise<HTMLTextAreaElement> {
    return (await screen.findByTestId(
      "presentation-scope-terms-input"
    )) as HTMLTextAreaElement;
  }
  const timeout = () =>
    new Error(
      "Request timeout - backend may be starting up. Please try again."
    );

  it("says the re-read failed too, so what is stored is UNKNOWN and the lists are from before", async () => {
    api.savePresentationScope.mockRejectedValueOnce(timeout());
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    load.mockRejectedValue(new Error("HTTP 503"));
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    const notice = await screen.findByTestId(
      "presentation-scope-outcome-unknown"
    );
    await waitFor(() =>
      expect(notice).toHaveTextContent(
        "reading the scope again failed too (HTTP 503), so what is stored is UNKNOWN: the lists above are from before the save"
      )
    );
    expect(notice).not.toHaveTextContent("were read after the save failed");
    // The lists still shown are labelled as the last read, and why.
    expect(screen.getByTestId("presentation-scope-stale")).toHaveTextContent(
      "The latest read of the presentation scope failed (HTTP 503)"
    );
    expect(screen.getByTestId("presentation-scope-in-force")).toHaveTextContent(
      "Last read (not in force)"
    );
    expect((await terms()).value).toBe("Globex");
  });

  it("reads after the failed save, never joining a read sent before it", async () => {
    api.savePresentationScope.mockRejectedValueOnce(timeout());
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    // A refresh is in flight when the save fails; its answer would be what
    // was stored BEFORE the save.
    let answerStale: (r: PresentationScopeRecord) => void = () => {};
    load.mockImplementationOnce(
      () =>
        new Promise<PresentationScopeRecord>((resolve) => {
          answerStale = resolve;
        })
    );
    act(() => {
      void store.reload();
    });
    // The PUT committed before its answer was lost: a read after it sees v4.
    load.mockResolvedValue(
      record({}, { confidential_terms: ["Globex"], version: 4 })
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    const notice = await screen.findByTestId(
      "presentation-scope-outcome-unknown"
    );
    await waitFor(() =>
      expect(notice).toHaveTextContent(
        "the lists above were read after the save failed"
      )
    );
    expect(load).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("presentation-scope-form")).toHaveTextContent(
      "(version 4)"
    );
    // The read sent before the save, answering late, changes nothing.
    await act(async () => {
      answerStale(record());
    });
    expect(screen.getByTestId("presentation-scope-form")).toHaveTextContent(
      "(version 4)"
    );
  });

  it("says the stored scope is being read while the re-read is in flight", async () => {
    api.savePresentationScope.mockRejectedValueOnce(timeout());
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    let answer: (r: PresentationScopeRecord) => void = () => {};
    load.mockImplementationOnce(
      () =>
        new Promise<PresentationScopeRecord>((resolve) => {
          answer = resolve;
        })
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    expect(
      await screen.findByTestId("presentation-scope-outcome-unknown")
    ).toHaveTextContent("what is stored is being read");
    await act(async () => {
      answer(record({}, { confidential_terms: ["Globex"], version: 4 }));
    });
    expect(
      screen.getByTestId("presentation-scope-outcome-unknown")
    ).toHaveTextContent("the lists above were read after the save failed");
  });

  it("after a conflict whose re-read fails, says so and keeps the edit bound to what it was made against", async () => {
    renderPanel();
    fireEvent.change(await terms(), {
      target: { value: "Acme Corp\nGlobex" },
    });
    // Another admin saves version 4; the panel's own re-read brings it in
    // under the open edit, which stays bound to version 3.
    load.mockResolvedValue(
      record({}, { confidential_terms: ["Initech"], version: 4 })
    );
    await act(async () => {
      await store.reload();
    });
    expect(screen.getByTestId("presentation-scope-form")).toHaveTextContent(
      "(version 4)"
    );
    api.savePresentationScope.mockRejectedValueOnce(conflict("version"));
    load.mockRejectedValue(new Error("HTTP 502"));
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    const notice = await screen.findByTestId("presentation-scope-conflict");
    await waitFor(() =>
      expect(notice).toHaveTextContent(
        "Reading what is stored now failed (HTTP 502), so it is UNKNOWN"
      )
    );
    expect(notice).not.toHaveTextContent(
      "The lists above are what is stored now"
    );
    expect((await terms()).value).toBe("Acme Corp\nGlobex");
    // Not re-bound to the version 4 held from before the save: what is
    // stored now is unknown, so the next save is still a compare-and-set
    // against version 3, the version the edit was made from.
    api.savePresentationScope.mockRejectedValueOnce(conflict("version"));
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    await waitFor(() =>
      expect(api.savePresentationScope).toHaveBeenCalledTimes(2)
    );
    expect(api.savePresentationScope.mock.calls[0][0]).toMatchObject({
      expected_version: 3,
    });
    expect(api.savePresentationScope.mock.calls[1][0]).toMatchObject({
      expected_version: 3,
    });
  });

  it("labels a held record as the last read when a later read fails, and clears it on success", async () => {
    renderPanel();
    await screen.findByTestId("presentation-scope-in-force");
    expect(screen.queryByTestId("presentation-scope-stale")).toBeNull();
    load.mockRejectedValueOnce(new Error("HTTP 504"));
    await act(async () => {
      await store.reload();
    });
    expect(screen.getByTestId("presentation-scope-stale")).toHaveTextContent(
      "failed (HTTP 504)"
    );
    expect(screen.getByTestId("presentation-scope-in-force")).toHaveTextContent(
      "Last read (not in force)"
    );
    await act(async () => {
      await store.reload();
    });
    expect(screen.queryByTestId("presentation-scope-stale")).toBeNull();
    expect(screen.getByTestId("presentation-scope-in-force")).toHaveTextContent(
      "In force"
    );
  });
});

describe("PresentationScopePanel — a save whose outcome is unknown", () => {
  async function terms(): Promise<HTMLTextAreaElement> {
    return (await screen.findByTestId(
      "presentation-scope-terms-input"
    )) as HTMLTextAreaElement;
  }

  it.each<[string, unknown]>([
    [
      "a client timeout",
      new Error(
        "Request timeout - backend may be starting up. Please try again."
      ),
    ],
    ["a lost connection", new TypeError("Failed to fetch")],
    ["a gateway error", backendError(504, "HTTP 504")],
  ])(
    "after %s, says the outcome is unknown and re-reads, keeping the edit",
    async (_name, failure) => {
      api.savePresentationScope.mockRejectedValueOnce(failure);
      renderPanel();
      fireEvent.change(await terms(), { target: { value: "Globex" } });
      fireEvent.click(screen.getByTestId("presentation-scope-save"));
      const notice = await screen.findByTestId(
        "presentation-scope-outcome-unknown"
      );
      expect(notice).toHaveTextContent("The save's outcome is unknown");
      expect(notice).toHaveTextContent("It may or may not have been stored");
      expect(screen.queryByTestId("presentation-scope-refused")).toBeNull();
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      expect((await terms()).value).toBe("Globex");
    }
  );

  it("shows a save that did land as stored once the re-read sees it", async () => {
    api.savePresentationScope.mockRejectedValueOnce(
      new Error(
        "Request timeout - backend may be starting up. Please try again."
      )
    );
    renderPanel();
    fireEvent.change(await terms(), { target: { value: "Globex" } });
    // The PUT committed before its answer was lost.
    load.mockResolvedValue(
      record({}, { confidential_terms: ["Globex"], version: 4 })
    );
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    await screen.findByTestId("presentation-scope-outcome-unknown");
    await waitFor(() =>
      expect(screen.getByTestId("presentation-scope-form")).toHaveTextContent(
        "(version 4)"
      )
    );
    // What was typed is what is stored: nothing left to save.
    expect(screen.getByTestId("presentation-scope-save")).toBeDisabled();
  });
});
