import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: fetchMock },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { getBaseUrl: () => "https://api.test" },
}));

import {
  deleteFile,
  fetchChangeLog,
  fetchFileBlob,
  revertPage,
  uploadFile,
  VersionConflictError,
} from "./api";

function lastCall(): { url: string; init: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [
    string,
    Record<string, unknown>,
  ];
  return { url, init };
}

describe("overview write calls send what the server reads", () => {
  beforeEach(() => fetchMock.mockReset());

  it("revertPage restores the named version, written on the version on screen", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ item: { id: "p1", version: 3 } }), {
        status: 200,
      })
    );
    await revertPage("p 1", 1, 2);
    const { url, init } = lastCall();
    expect(url).toBe(
      "https://api.test/api/v1/overview/pages/p%201/versions/1/revert"
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "If-Match": '"2"',
      "X-Overview-Source": "ui",
    });
  });

  it("revertPage hands back the server's copy on a conflict", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "version_conflict",
          current: { id: "p1", version: 5 },
        }),
        { status: 409 }
      )
    );
    await expect(revertPage("p1", 1, 2)).rejects.toBeInstanceOf(
      VersionConflictError
    );
  });

  it("deleteFile names the file and its version", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteFile("f1", 1);
    const { url, init } = lastCall();
    expect(url).toBe("https://api.test/api/v1/overview/files/f1");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({ "If-Match": '"1"' });
  });

  it("fetchFileBlob reads the authenticated content route", async () => {
    fetchMock.mockResolvedValue(new Response("%PDF", { status: 200 }));
    await fetchFileBlob("f1");
    expect(lastCall().url).toBe(
      "https://api.test/api/v1/overview/files/f1/content"
    );
  });

  it("uploadFile sends multipart under its key, with a timeout sized to the file", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ item: { id: "f1" } }), { status: 201 })
    );
    const big = new File([new Uint8Array(20_000_000)], "deck.pptx");
    await uploadFile(big, "key-1", "doc-1");
    const { url, init } = lastCall();
    expect(url).toBe("https://api.test/api/v1/overview/files");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("page_id")).toBe("doc-1");
    expect(init.headers).toMatchObject({ "Idempotency-Key": "key-1" });
    expect(init.timeoutMs).toBe(400_000);
    expect(init.idempotent).toBe(true);
  });
});

describe("fetchChangeLog sends the source filter and limit the server reads", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ entries: [], truncated: false }), {
          status: 200,
        })
    );
  });

  function sentQuery(): URLSearchParams {
    const { url, init } = lastCall();
    expect(init.method).toBe("GET");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://api.test/api/v1/overview/change-log"
    );
    return parsed.searchParams;
  }

  it("fetchChangeLog carries source=api when asked, with the limit", async () => {
    await fetchChangeLog("pages", "p1", { source: "api", limit: 7 });
    const q = sentQuery();
    expect(q.get("resource")).toBe("pages");
    expect(q.get("record_id")).toBe("p1");
    expect(q.getAll("source")).toEqual(["api"]);
    expect(q.get("limit")).toBe("7");
  });

  it("fetchChangeLog omits source when not asked, and defaults the limit to 20", async () => {
    await fetchChangeLog("pages", null);
    const q = sentQuery();
    expect(q.has("source")).toBe(false);
    expect(q.has("record_id")).toBe(false);
    expect(q.get("limit")).toBe("20");
  });

  it("fetchChangeLog keeps an explicit limit without a source", async () => {
    await fetchChangeLog("milestones", null, { limit: 50 });
    const q = sentQuery();
    expect(q.has("source")).toBe(false);
    expect(q.get("limit")).toBe("50");
  });
});
