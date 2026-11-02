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
 * - an older read that settles after a newer one cannot overwrite its answer,
 *   whether it fails or delivers;
 * - `isDirty` says an edit differs from what was read or saved: never while
 *   nothing was read, and no longer once a save lands.
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
  ok,
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

/** A call held open until the test answers it. */
interface HeldCall {
  key: string;
  resolve: (answer: Response) => void;
}

/** Hold every call from now on until the test answers it. */
function holdCalls(): HeldCall[] {
  const held: HeldCall[] = [];
  fetchMock.mockImplementation(
    (url: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        held.push({ key: routeKey(url, init), resolve });
      })
  );
  return held;
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

  it("lets an older read that fails after a newer one delivered change nothing", async () => {
    const { result } = renderHook(() => useConstraints({ loadOnMount: false }));
    // The first read's two calls hang until released; the second's answer.
    const held = holdCalls();
    let older: Promise<void> = Promise.resolve();
    act(() => {
      older = result.current.reload();
    });
    serveRoutes();
    await act(() => result.current.reload());
    expect(result.current.readState).toBe("read");

    // The older read now fails, after the newer one delivered.
    await act(async () => {
      for (const call of held) call.resolve(respond(RUNNER_UNREACHABLE));
      await older;
    });

    expect(result.current.readState).toBe("read");
    expect(result.current.readFailure).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("keeps the newer read's answer when an older read delivers after it", async () => {
    const { result } = renderHook(() => useConstraints({ loadOnMount: false }));
    const held = holdCalls();
    let older: Promise<void> = Promise.resolve();
    act(() => {
      older = result.current.reload();
    });
    serveRoutes();
    await act(() => result.current.reload());
    expect(result.current.constraints.map((c) => c.id)).toEqual([
      NO_SECRETS.id,
    ]);

    // The older read now delivers a different answer, after the newer one.
    const olderAnswer: Record<string, RouteAnswer> = {
      "GET /active": ok([
        { ...NO_SECRETS, id: "builtin:no-env-files", name: "No env files" },
      ]),
      "GET /config": ok({
        toml: "[resources]\nmax_wall_time_secs = 99\n",
        path: "/srv/acme-old/.qontinui/constraints.toml",
      }),
    };
    expect(held.map((call) => call.key).sort()).toEqual(
      Object.keys(olderAnswer).sort()
    );
    await act(async () => {
      for (const call of held) {
        const answer = olderAnswer[call.key];
        if (answer === undefined) throw new Error(`unscripted ${call.key}`);
        call.resolve(respond(answer));
      }
      await older;
    });

    expect(result.current.constraints.map((c) => c.id)).toEqual([
      NO_SECRETS.id,
    ]);
    expect(result.current.resourceLimits).toEqual({});
    expect(result.current.configPath).toBeUndefined();
    expect(result.current.readState).toBe("read");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.loading).toBe(false);
  });
});

describe("useConstraints isDirty", () => {
  it("is false while the read is out", () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    const { result } = renderHook(() => useConstraints());

    expect(result.current.readState).toBe("pending");
    expect(result.current.isDirty).toBe(false);
  });

  it("is false when no read delivered, even with an edit in hand", async () => {
    // Nothing was read, so there is no config for an edit to differ from,
    // and `save` would refuse it anyway.
    routes["GET /active"] = RUNNER_UNREACHABLE;
    const { result } = renderHook(() => useConstraints());
    await waitFor(() => expect(result.current.readState).toBe("unknown"));
    expect(result.current.isDirty).toBe(false);

    act(() =>
      result.current.addConstraint({ ...NO_SECRETS, id: "project:added" })
    );

    expect(result.current.isDirty).toBe(false);
  });

  it("is true for an edit to what was read, and false again once the save lands", async () => {
    const { result } = renderHook(() => useConstraints());
    await waitFor(() => expect(result.current.readState).toBe("read"));
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.toggleBuiltin("no-secrets", false));
    expect(result.current.isDirty).toBe(true);

    let saved = false;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(true);
    expect(calls()).toContain("POST /config");
    expect(result.current.isDirty).toBe(false);
  });
});
