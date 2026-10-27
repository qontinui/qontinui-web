/**
 * ConstraintsPanel: the constraints routes are for platform admins only (coord
 * finding `5a6791e9-607c-4658-82e2-3b509e459996`), and a read can fail. The
 * panel must say which happened:
 *
 * - a viewer who is not a platform admin sees the admin-only state, with no
 *   list, no empty sentence and no editor or Save;
 * - a read that never delivered is a labelled UNKNOWN with its reason, never
 *   "No built-in constraints loaded", and offers no editor either, since a
 *   save would overwrite the project's config with an empty editor;
 * - a save the backend refuses takes the editors away with the refusal;
 * - the "unsaved" chip shows only for an edit to what was read, and goes
 *   once the save lands: never while the read is out, failed or refused;
 * - a re-read is offered beside Save while nothing is unsaved, and one that
 *   fails keeps the lists, labelled stale with its reason.
 *
 * The panel is rendered whole, with the network stubbed at `httpClient.fetch`
 * (`src/test/constraintsRoutes.ts`), so the real API client, its refusal
 * predicate and the hook all run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  ADMIN_REFUSED,
  NO_SECRETS,
  RUNNER_UNREACHABLE,
  RUNNER_UNREACHABLE_SENTENCE,
  readableRoutes,
  respond,
  routeKey,
  type RouteAnswer,
} from "@/test/constraintsRoutes";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

import { CONSTRAINTS_ADMIN_ONLY } from "@/lib/constraints-api";
import { ConstraintsPanel } from "./ConstraintsPanel";

let routes: Record<string, RouteAnswer>;

beforeEach(() => {
  routes = readableRoutes();
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const answer = routes[routeKey(url, init)];
    if (answer === undefined) {
      throw new Error(`unscripted call ${routeKey(url, init)}`);
    }
    return respond(answer);
  });
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function calls(): string[] {
  return fetchMock.mock.calls.map(([url, init]) =>
    routeKey(url, init as RequestInit | undefined)
  );
}

function expectNoListAndNoEditor(): void {
  expect(screen.queryByText("Built-in Constraints")).toBeNull();
  expect(screen.queryByText("No built-in constraints loaded")).toBeNull();
  expect(screen.queryByText(/No custom constraints/)).toBeNull();
  expect(screen.queryByTitle("Save constraints")).toBeNull();
  expect(screen.queryByText("Add")).toBeNull();
}

describe("ConstraintsPanel", () => {
  it("shows a viewer who is not a platform admin the admin-only state", async () => {
    routes["GET /active"] = ADMIN_REFUSED;
    routes["GET /config"] = ADMIN_REFUSED;

    render(<ConstraintsPanel />);

    const note = await screen.findByTestId("constraints-admin-only");
    expect(note.textContent).toContain(CONSTRAINTS_ADMIN_ONLY);
    expectNoListAndNoEditor();
    expect(screen.queryByTestId("constraints-read-failed")).toBeNull();
    expect(screen.queryByText("unsaved")).toBeNull();
  });

  it("labels a read that failed as unknown, with its reason, and offers no editor", async () => {
    routes["GET /active"] = RUNNER_UNREACHABLE;

    render(<ConstraintsPanel />);

    const note = await screen.findByTestId("constraints-read-failed");
    expect(note.textContent).toContain("which constraints apply is unknown");
    expect(note.textContent).toContain(
      `Reason: Failed to fetch active constraints: ${RUNNER_UNREACHABLE_SENTENCE}`
    );
    expectNoListAndNoEditor();
    expect(screen.queryByTestId("constraints-admin-only")).toBeNull();
    // Nothing was read, so nothing can be unsaved.
    expect(screen.queryByText("unsaved")).toBeNull();
  });

  it("reads again from the unknown state and then shows what the runner answered", async () => {
    routes["GET /active"] = RUNNER_UNREACHABLE;
    render(<ConstraintsPanel />);
    await screen.findByTestId("constraints-read-failed");

    routes = readableRoutes();
    fireEvent.click(screen.getByTestId("constraints-read-retry"));

    expect(await screen.findByText(NO_SECRETS.name)).toBeTruthy();
    expect(screen.queryByTestId("constraints-read-failed")).toBeNull();
    expect(screen.getByTitle("Save constraints")).toBeTruthy();
  });

  it("shows an admin the constraints and their editors", async () => {
    render(<ConstraintsPanel />);

    expect(await screen.findByText(NO_SECRETS.name)).toBeTruthy();
    expect(screen.getByText("Built-in Constraints")).toBeTruthy();
    expect(screen.getByTitle("Save constraints")).toBeTruthy();
    expect(screen.queryByTestId("constraints-admin-only")).toBeNull();
    expect(screen.queryByTestId("constraints-read-failed")).toBeNull();
    expect(screen.queryByTestId("constraints-read-stale")).toBeNull();
  });

  it("takes the editors away when the backend refuses the save", async () => {
    render(<ConstraintsPanel />);
    await screen.findByText(NO_SECRETS.name);
    routes["POST /validate"] = ADMIN_REFUSED;

    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(screen.getByTitle("Save constraints"));

    expect(await screen.findByTestId("constraints-admin-only")).toBeTruthy();
    expectNoListAndNoEditor();
    expect(calls()).not.toContain("POST /config");
  });
});

describe("ConstraintsPanel while the read is out", () => {
  it("paints its loader before any read has started", () => {
    // The server render is the first paint, and runs no effect: no read has
    // been issued, so `loading` is still false and only `pending` says wait.
    const html = renderToString(<ConstraintsPanel />);

    expect(html).toContain('data-testid="constraints-loading"');
    expect(html).not.toContain("No built-in constraints loaded");
    expect(html).not.toContain("unsaved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows its loader, never an empty list", async () => {
    // A read that never answers: the first render and every one after it.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    render(<ConstraintsPanel />);

    expect(screen.getByTestId("constraints-loading")).toBeTruthy();
    expectNoListAndNoEditor();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("constraints-loading")).toBeTruthy();
    expectNoListAndNoEditor();
    expect(screen.queryByText("unsaved")).toBeNull();
  });
});

describe("ConstraintsPanel after a read", () => {
  function saveButton(): HTMLButtonElement {
    return screen.getByTitle("Save constraints") as HTMLButtonElement;
  }

  it("says an edit is unsaved until the save lands", async () => {
    render(<ConstraintsPanel />);
    await screen.findByText(NO_SECRETS.name);
    expect(screen.queryByText("unsaved")).toBeNull();
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByText("unsaved")).toBeTruthy();
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());

    expect(await screen.findByText("Constraints saved")).toBeTruthy();
    expect(calls()).toContain("POST /config");
    expect(screen.queryByText("unsaved")).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it("keeps the lists, labelled stale with the reason, when a re-read fails", async () => {
    render(<ConstraintsPanel />);
    await screen.findByText(NO_SECRETS.name);
    expect(screen.queryByTestId("constraints-read-stale")).toBeNull();

    routes["GET /active"] = RUNNER_UNREACHABLE;
    fireEvent.click(screen.getByTestId("constraints-reread"));

    const note = await screen.findByTestId("constraints-read-stale");
    expect(note.textContent).toContain(
      "What is shown below is from an earlier read and may be out of date."
    );
    expect(note.textContent).toContain(
      `Reason: Failed to fetch active constraints: ${RUNNER_UNREACHABLE_SENTENCE}`
    );
    // What the earlier read delivered is still there, with its editors.
    expect(screen.getByText("Built-in Constraints")).toBeTruthy();
    expect(screen.getByText(NO_SECRETS.name)).toBeTruthy();
    expect(saveButton()).toBeTruthy();
    expect(screen.queryByTestId("constraints-read-failed")).toBeNull();

    // A re-read that delivers takes the label away.
    routes = readableRoutes();
    fireEvent.click(screen.getByTestId("constraints-reread"));

    await waitFor(() =>
      expect(screen.queryByTestId("constraints-read-stale")).toBeNull()
    );
    expect(screen.getByText(NO_SECRETS.name)).toBeTruthy();
  });

  it("offers no re-read while an edit is unsaved, since its answer would replace the edit", async () => {
    render(<ConstraintsPanel />);
    await screen.findByText(NO_SECRETS.name);
    expect(screen.getByTestId("constraints-reread")).toBeTruthy();

    fireEvent.click(screen.getByText("Add"));

    expect(screen.queryByTestId("constraints-reread")).toBeNull();
  });
});
