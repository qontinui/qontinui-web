import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three behaviours the list hook exists for — optimistic apply, rollback
 * on failure, and the server's copy on a conflict — against a mocked
 * contract, so each can be made to happen on purpose.
 */

const api = vi.hoisted(() => ({
  getResource: vi.fn(),
  listResource: vi.fn(),
  updateResource: vi.fn(),
  createResource: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, ...api };
});

import { ResourceError, VersionConflictError } from "./api";
import { useResourceList, useResourceRecord } from "./useResource";

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
      3,
      "ui"
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

  it("names an import as its source, and drops a deleted record", async () => {
    const hook = await loaded();
    api.updateResource.mockResolvedValue({ ...vision, version: 4 });
    await act(async () => {
      await hook.result.current.update(
        vision,
        { body: "pasted" },
        { source: "import" }
      );
    });
    expect(api.updateResource).toHaveBeenCalledWith(
      "intent-documents",
      vision.id,
      { body: "pasted" },
      3,
      "import"
    );
    act(() => hook.result.current.drop(vision.id));
    expect(items(hook)).toEqual([]);
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

describe("useResourceRecord", () => {
  async function record() {
    api.getResource.mockResolvedValue({ item: vision, can_edit: true });
    const hook = renderHook(() =>
      useResourceRecord<Doc>("intent-documents", vision.id, {
        hold: false,
        reloadKey: "t1",
      })
    );
    await waitFor(() => expect(hook.result.current.record.state).toBe("ready"));
    return hook;
  }

  it("reads nothing until it has an id and the project is known", () => {
    renderHook(() =>
      useResourceRecord<Doc>("intent-documents", null, {
        hold: false,
        reloadKey: "t1",
      })
    );
    renderHook(() =>
      useResourceRecord<Doc>("intent-documents", vision.id, {
        hold: true,
        reloadKey: "t1",
      })
    );
    expect(api.getResource).not.toHaveBeenCalled();
  });

  it("writes on the version the working copy was BUILT on, naming its source", async () => {
    const hook = await record();
    const saved = { ...vision, version: 4, body: "new" };
    api.updateResource.mockResolvedValue(saved);
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.update({ body: "new" }, 2, {
        source: "import",
      });
    });
    expect(api.updateResource).toHaveBeenCalledWith(
      "intent-documents",
      vision.id,
      { body: "new" },
      2,
      "import"
    );
    expect(result).toEqual({ ok: true, item: saved });
    const state = hook.result.current.record;
    expect(state.state === "ready" && state.item).toEqual(saved);
  });

  it("holds THEIR copy on a conflict and hands it back", async () => {
    const hook = await record();
    const theirs = { ...vision, version: 5, body: "theirs" };
    api.updateResource.mockRejectedValue(new VersionConflictError(theirs));
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.update({ body: "mine" }, 3);
    });
    expect(result).toEqual({ ok: false, conflict: theirs });
    const state = hook.result.current.record;
    expect(state.state === "ready" && state.item).toEqual(theirs);
  });

  it("passes the server's reason through, so the caller can offer its fix", async () => {
    const hook = await record();
    api.updateResource.mockRejectedValue(
      new ResourceError(422, "source_page_not_found", "Not a document here.")
    );
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.update({ source_page_id: "x" }, 3);
    });
    expect(result).toEqual({
      ok: false,
      error: "Not a document here.",
      code: "source_page_not_found",
    });
  });

  it("says when the record is not there, by status", async () => {
    api.getResource.mockRejectedValue(
      new ResourceError(404, "not_found", "gone")
    );
    const hook = renderHook(() =>
      useResourceRecord<Doc>("intent-documents", "nope", {
        hold: false,
        reloadKey: "t1",
      })
    );
    await waitFor(() => expect(hook.result.current.record.state).toBe("error"));
    const state = hook.result.current.record;
    expect(state.state === "error" && state.status).toBe(404);
  });
});
