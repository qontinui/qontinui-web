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
 * - a save the backend refuses takes the editors away with the refusal.
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
  });
});
