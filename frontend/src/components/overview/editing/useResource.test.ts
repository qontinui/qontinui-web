import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three behaviours the list hook exists for — optimistic apply, rollback
 * on failure, and the server's copy on a conflict — against a mocked
 * contract, so each can be made to happen on purpose.
 */

const api = vi.hoisted(() => ({
  listResource: vi.fn(),
  updateResource: vi.fn(),
  createResource: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, ...api };
});

import { ResourceError, VersionConflictError } from "./api";
import { useResourceList } from "./useResource";

interface Doc {
  id: string;
  version: number;
  body: string;
}

const vision: Doc = { id: "product_intent:vision", version: 3, body: "old" };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loaded() {
  const hook = renderHook(() =>
    useResourceList<Doc>("intent-documents", { hold: false, reloadKey: "t1" })
  );
  await waitFor(() => expect(hook.result.current.list.state).toBe("ready"));
  return hook;
}

const items = (hook: Awaited<ReturnType<typeof loaded>>) => {
  const list = hook.result.current.list;
  if (list.state !== "ready") throw new Error("not ready");
  return list.items;
};

beforeEach(() => {
  vi.resetAllMocks();
  api.listResource.mockResolvedValue({
    items: [vision],
    total: 1,
    can_edit: true,
    degraded: null,
  });
});

describe("useResourceList", () => {
  it("does not read while the project is unknown", () => {
    renderHook(() =>
      useResourceList<Doc>("intent-documents", { hold: true, reloadKey: null })
    );
    expect(api.listResource).not.toHaveBeenCalled();
  });

  it("shows the optimistic result, then the server's", async () => {
    const hook = await loaded();
    const pending = deferred<Doc>();
    api.updateResource.mockReturnValue(pending.promise);

    let done!: Promise<unknown>;
    act(() => {
      done = hook.result.current.update(
        vision,
        { body: "new" },
        { optimistic: (d) => ({ ...d, body: "new" }) }
      );
    });
    expect(items(hook)[0].body).toBe("new");
    // The write named the version it was built on.
    expect(api.updateResource).toHaveBeenCalledWith(
      "intent-documents",
      vision.id,
      { body: "new" },
      3
    );

    await act(async () => {
      pending.resolve({ ...vision, body: "new (server)", version: 4 });
      await done;
    });
    expect(items(hook)[0]).toEqual({
      ...vision,
      body: "new (server)",
      version: 4,
    });
  });

  it("rolls back a failed save and says why in plain words", async () => {
    const hook = await loaded();
    api.updateResource.mockRejectedValue(
      new ResourceError(503, null, "upstream")
    );

    let result: unknown;
    await act(async () => {
      result = await hook.result.current.update(
        vision,
        { body: "new" },
        { optimistic: (d) => ({ ...d, body: "new" }) }
      );
    });
    expect(items(hook)[0].body).toBe("old");
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/isn't responding/),
    });
  });

  it("puts THEIR copy in the list on a conflict and hands it back", async () => {
    const hook = await loaded();
    const theirs = { ...vision, body: "theirs", version: 4 };
    api.updateResource.mockRejectedValue(new VersionConflictError(theirs));

    let result: unknown;
    await act(async () => {
      result = await hook.result.current.update(
        vision,
        { body: "mine" },
        { optimistic: (d) => ({ ...d, body: "mine" }) }
      );
    });
    expect(items(hook)[0]).toEqual(theirs);
    expect(result).toEqual({ ok: false, conflict: theirs });
  });

  it("adds a created record, sending a retry-safe key", async () => {
    const hook = await loaded();
    const created = { id: "initiative:launch", version: 1, body: "# Launch" };
    api.createResource.mockResolvedValue(created);
    await act(async () => {
      await hook.result.current.create({ kind: "initiative", name: "launch" });
    });
    expect(items(hook)).toEqual([vision, created]);
    const key = api.createResource.mock.calls[0][2] as string;
    expect(key.length).toBeGreaterThan(8);
  });
});
