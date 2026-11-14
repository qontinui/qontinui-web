/**
 * The saved tab lists client — what it sends, and how it surfaces what comes
 * back. Plan
 * `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3. The routes themselves are pinned against the OpenAPI snapshot by
 * `route-contract.test.ts`; this file pins the client's reading of answers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/errors/backend-error-message";
import {
  CAPTURE_REFUSALS,
  DEVICE_A,
  createFakeNetwork,
  detail,
  seedList,
  type FakeNetwork,
} from "@/test/savedSessionListsFixture";

const holder = vi.hoisted(() => ({
  fetch: null as
    | null
    | ((url: string, init?: RequestInit) => Promise<Response>),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (url: string, init?: RequestInit) => {
      if (holder.fetch === null) throw new Error("no fake network installed");
      return holder.fetch(url, init);
    },
  },
}));

import {
  deleteSavedSessionList,
  getSavedSessionList,
  isSavedListGone,
  listSavedSessionLists,
  refusalDiscriminator,
  saveMayHaveLanded,
  saveSessionList,
} from "./savedSessionLists";

let net: FakeNetwork;

beforeEach(() => {
  net = createFakeNetwork();
  holder.fetch = net.fetch;
});

describe("saveSessionList", () => {
  it("posts exactly {device_id, title} — the backend refuses anything more", async () => {
    const saved = await saveSessionList({ device_id: DEVICE_A, title: "x" });
    expect(net.calls).toEqual([
      {
        method: "POST",
        path: "/api/v1/saved-session-lists",
        body: { device_id: DEVICE_A, title: "x" },
      },
    ]);
    expect(saved.device_id).toBe(DEVICE_A);
    expect(saved.layout.pages.length).toBeGreaterThan(0);
  });

  it("rejects each typed refusal as a BackendError naming its discriminator", async () => {
    for (const [discriminator, refusal] of Object.entries(CAPTURE_REFUSALS)) {
      net.captureAnswer = refusal;
      const err = await saveSessionList({
        device_id: DEVICE_A,
        title: null,
      }).catch((e: unknown) => e);
      expect(err, discriminator).toBeInstanceOf(BackendError);
      expect((err as BackendError).status).toBe(refusal.status);
      expect(refusalDiscriminator(err)).toBe(discriminator);
      // Every typed refusal is raised before the row is written.
      expect(saveMayHaveLanded(err), discriminator).toBe(false);
    }
  });

  it("treats a missing answer, or a 5xx with no refusal, as possibly saved", async () => {
    net.captureAnswer = new Error(
      "Request timeout - backend may be starting up. Please try again."
    );
    const timeout = await saveSessionList({ device_id: DEVICE_A }).catch(
      (e: unknown) => e
    );
    expect(saveMayHaveLanded(timeout)).toBe(true);

    net.captureAnswer = { status: 504, body: "<html>gateway timeout</html>" };
    const gateway = await saveSessionList({ device_id: DEVICE_A }).catch(
      (e: unknown) => e
    );
    expect(gateway).toBeInstanceOf(BackendError);
    expect(refusalDiscriminator(gateway)).toBeNull();
    expect(saveMayHaveLanded(gateway)).toBe(true);

    // A 4xx is the backend refusing the request: nothing was written.
    net.captureAnswer = {
      status: 422,
      body: { detail: [{ loc: ["body", "title"], msg: "too long" }] },
    };
    const invalid = await saveSessionList({ device_id: DEVICE_A }).catch(
      (e: unknown) => e
    );
    expect(saveMayHaveLanded(invalid)).toBe(false);
  });
});

describe("listSavedSessionLists", () => {
  it("returns the backend's lists", async () => {
    seedList(net, detail({ id: "l1" }));
    const lists = await listSavedSessionLists();
    expect(lists.map((l) => l.id)).toEqual(["l1"]);
  });

  it("rejects a 2xx that carried no list rather than calling it empty", async () => {
    net.listAnswer = { status: 200, body: { lists: [] } };
    await expect(listSavedSessionLists()).rejects.toThrow(/without a list/);
  });
});

describe("getSavedSessionList / deleteSavedSessionList", () => {
  it("reads one list with its layout and coord answers", async () => {
    seedList(net, detail({ id: "l1" }));
    const one = await getSavedSessionList("l1");
    expect(one.layout.pages.length).toBe(4);
    expect(Object.keys(one.coord_status).length).toBe(5);
  });

  it("reads a 404 as gone — an answer, not an outage", async () => {
    const err = await getSavedSessionList("missing").catch((e: unknown) => e);
    expect(isSavedListGone(err)).toBe(true);
    expect(refusalDiscriminator(err)).toBe("saved_session_list_not_found");
    const failed = new BackendError(
      { kind: "unstructured", sentence: "HTTP 502" },
      502
    );
    expect(isSavedListGone(failed)).toBe(false);
    expect(isSavedListGone(new Error("network"))).toBe(false);
  });

  it("deletes and resolves on 204", async () => {
    seedList(net, detail({ id: "l1" }));
    await expect(deleteSavedSessionList("l1")).resolves.toBeUndefined();
    expect(net.calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/api/v1/saved-session-lists/l1",
    });
    const again = await deleteSavedSessionList("l1").catch((e: unknown) => e);
    expect(isSavedListGone(again)).toBe(true);
  });
});
