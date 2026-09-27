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
