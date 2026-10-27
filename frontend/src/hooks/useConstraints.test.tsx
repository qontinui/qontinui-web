/**
 * useConstraints publishes what its read answered (`readState`,
 * `readFailure`), so the constraints UI never shows a refusal or a failure as
 * "no constraints". These are the cases the panel alone cannot reach:
 *
 * - a read that fails AFTER one delivered keeps the delivered constraints and
 *   says why they are stale;
 * - a refusal after a read drops everything that read delivered;
 * - `save` writes nothing unless the constraints were read, since it would
 *   overwrite the project's config with whatever the editor holds;
 * - an older read that settles after a newer one cannot overwrite its answer.
 *
 * The network is stubbed at `httpClient.fetch` (`src/test/constraintsRoutes.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
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

import { useConstraints } from "./useConstraints";

let routes: Record<string, RouteAnswer>;

function serveRoutes(): void {
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const answer = routes[routeKey(url, init)];
    if (answer === undefined) {
      throw new Error(`unscripted call ${routeKey(url, init)}`);
    }
    return respond(answer);
  });
}

beforeEach(() => {
  routes = readableRoutes();
  serveRoutes();
});

afterEach(() => {
  fetchMock.mockReset();
});

function calls(): string[] {
  return fetchMock.mock.calls.map(([url, init]) =>
    routeKey(url, init as RequestInit | undefined)
  );
}

const UNREACHABLE_REASON = `Failed to fetch active constraints: ${RUNNER_UNREACHABLE_SENTENCE}`;

describe("useConstraints", () => {
  it("keeps what a read delivered, labelled stale, when a later read fails", async () => {
    const { result } = renderHook(() => useConstraints());
    await waitFor(() => expect(result.current.readState).toBe("read"));

    routes["GET /active"] = RUNNER_UNREACHABLE;
    await act(() => result.current.reload());

    expect(result.current.readState).toBe("read");
    expect(result.current.readFailure).toBe(UNREACHABLE_REASON);
    expect(result.current.constraints.map((c) => c.id)).toEqual([
      NO_SECRETS.id,
    ]);
  });

  it("drops everything a read delivered when the next read is refused", async () => {
    const { result } = renderHook(() => useConstraints());
    await waitFor(() => expect(result.current.readState).toBe("read"));
    act(() => result.current.toggleBuiltin("no-secrets", false));
    expect(result.current.isDirty).toBe(true);

    routes["GET /active"] = ADMIN_REFUSED;
    routes["GET /config"] = ADMIN_REFUSED;
    await act(() => result.current.reload());

    expect(result.current.readState).toBe("admin-only");
    expect(result.current.constraints).toEqual([]);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.readFailure).toBeNull();
  });

  it("writes nothing when the constraints were never read", async () => {
    routes["GET /active"] = RUNNER_UNREACHABLE;
    const { result } = renderHook(() => useConstraints());
    await waitFor(() => expect(result.current.readState).toBe("unknown"));
    expect(result.current.readFailure).toBe(UNREACHABLE_REASON);
    act(() =>
      result.current.addConstraint({ ...NO_SECRETS, id: "project:added" })
    );

    let saved = true;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(false);
    expect(calls().filter((call) => call.startsWith("POST"))).toEqual([]);
    expect(result.current.error).toMatch(/were not read/);
  });

  it("lets only the newest read settle the state", async () => {
    const { result } = renderHook(() => useConstraints({ loadOnMount: false }));
    // The first read's two calls hang until released; the second's answer.
    const held: Array<(answer: Response) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          held.push(resolve);
        })
    );
    let older: Promise<void> = Promise.resolve();
    act(() => {
      older = result.current.reload();
    });
    serveRoutes();
    await act(() => result.current.reload());
    expect(result.current.readState).toBe("read");

    // The older read now fails, after the newer one delivered.
    await act(async () => {
      for (const resolve of held) resolve(respond(RUNNER_UNREACHABLE));
      await older;
    });

    expect(result.current.readState).toBe("read");
    expect(result.current.readFailure).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
