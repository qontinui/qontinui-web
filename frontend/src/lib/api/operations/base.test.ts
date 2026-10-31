import { describe, expect, it } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { describeCoordPollError } from "@/components/operations/coordPollError";
import {
  ANSWER_UNREADABLE_REASON,
  outcomeUnknownReason,
} from "@/components/admin/coord/writeOutcome";
import { UnreadableAnswerError } from "@/services/http-client";
import {
  backendError,
  backendErrorMessage,
} from "@/lib/errors/backend-error-message";
import {
  operationsErrorMessage,
  operationsErrorReading,
  readJson,
} from "./base";

/**
 * Pins the `/operations` client's one response reader against the contract
 * its callers already parse: `httpClient.get`'s rejection
 * `<METHOD> <url> failed: <status> - <body>` (`services/http-client.ts`), read
 * back by `httpStatusOf` / `httpBodyOf` / `describeCoordPollError`, and the
 * operator sentence `backendErrorMessage` gives for the same `Response`.
 */

const REQUEST = "GET /api/v1/operations/coord/members";

async function rejection(p: Promise<unknown>): Promise<Error> {
  const err = await p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(Error);
  return err as Error;
}

describe("readJson", () => {
  it("resolves a 2xx to its parsed body", async () => {
    const res = new Response('{"operators":[]}', { status: 200 });
    await expect(readJson(res, REQUEST)).resolves.toEqual({ operators: [] });
  });

  it("rejects a non-2xx in httpClient.get's exact error shape", async () => {
    const res = new Response('{"detail":"nope"}', { status: 403 });
    const err = await rejection(readJson(res, REQUEST));
    expect(err.message).toBe(
      'GET /api/v1/operations/coord/members failed: 403 - {"detail":"nope"}'
    );
    expect(httpStatusOf(err)).toBe(403);
    expect(httpBodyOf(err)).toBe('{"detail":"nope"}');
  });

  it("words the rejection with the caller's method", async () => {
    const res = new Response("boom", { status: 500 });
    const err = await rejection(
      readJson(res, "PATCH /api/v1/operations/pr-merge/settings")
    );
    expect(err.message).toBe(
      "PATCH /api/v1/operations/pr-merge/settings failed: 500 - boom"
    );
  });

  it("stands in 'Unknown error' for a body that cannot be read, as httpClient.get does", async () => {
    const res = {
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error("stream broke")),
    } as unknown as Response;
    const err = await rejection(readJson(res, REQUEST));
    expect(err.message).toBe(
      "GET /api/v1/operations/coord/members failed: 502 - Unknown error"
    );
  });

  it("keeps coord's deadline answer readable to describeCoordPollError", async () => {
    const res = new Response('{"error":"deadline","budget_ms":2500}', {
      status: 503,
    });
    const err = await rejection(readJson(res, REQUEST));
    expect(describeCoordPollError(err)).toBe(
      "coord read deadline (2500 ms) exceeded — unknown"
    );
  });

  it("rejects an unparseable 2xx by default", async () => {
    const res = new Response("not json", { status: 200 });
    await expect(readJson(res, REQUEST)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("names a 2xx whose body broke off mid-read as an answer that came back", async () => {
    const res = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new TypeError("terminated")),
    } as unknown as Response;
    const err = await rejection(readJson(res, REQUEST));
    expect(err).toBeInstanceOf(UnreadableAnswerError);
    expect(err.message).toBe("terminated");
    expect(outcomeUnknownReason(err)).toBe(ANSWER_UNREADABLE_REASON);
  });

  it("hands a caller's own abort back as it came", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const res = {
      ok: true,
      status: 200,
      json: () => Promise.reject(abort),
    } as unknown as Response;
    await expect(readJson(res, REQUEST)).rejects.toBe(abort);
  });

  it("resolves null for an unparseable 2xx when asked to", async () => {
    const res = new Response("not json", { status: 200 });
    await expect(
      readJson(res, REQUEST, { unparseable: "null" })
    ).resolves.toBeNull();
  });

  it("still rejects a non-2xx when an unparseable 2xx would be null", async () => {
    const res = new Response("nope", { status: 500 });
    const err = await rejection(
      readJson(res, REQUEST, { unparseable: "null" })
    );
    expect(httpStatusOf(err)).toBe(500);
  });
});

describe("operationsErrorMessage", () => {
  it.each([
    ['{"detail":"Only admins may do that."}', 403],
    ['{"error":"not_admin_in_target_tenant"}', 403],
    ["<html><body>502 Bad Gateway</body></html>", 502],
    ["{}", 500],
    ["", 404],
  ])(
    "says what backendErrorMessage says about the same response (%s, %i)",
    async (body, status) => {
      const expected = await backendErrorMessage(
        new Response(body, { status })
      );
      const err = await rejection(
        readJson(new Response(body, { status }), REQUEST)
      );
      expect(operationsErrorMessage(err)).toBe(expected);
    }
  );

  it("bounds the sentence to the surface's limit", async () => {
    const err = await rejection(
      readJson(new Response("x".repeat(50), { status: 400 }), REQUEST)
    );
    expect(operationsErrorMessage(err, 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("returns any other error's own message unchanged", () => {
    expect(operationsErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Failed to fetch"
    );
    expect(operationsErrorMessage("plain")).toBe("plain");
  });
});

describe("operationsErrorReading", () => {
  const refusal = {
    code: "workspace_root_unresolved",
    next_action: { kind: "set_setting", target: "workspace_root" },
    glossary_terms: ["tenant"],
    observed_at: "2026-09-29T00:00:00Z",
    source: "web_backend",
  };

  it("carries the refusal envelope a rejected body held", async () => {
    const body = JSON.stringify({ error: "x", refusal });
    const err = await rejection(
      readJson(new Response(body, { status: 409 }), REQUEST)
    );
    const reading = operationsErrorReading(err);
    expect(reading.kind).toBe("refusal");
    // The sentence is the one operationsErrorMessage already shows.
    expect(reading.sentence).toBe(operationsErrorMessage(err));
  });

  it("reads a pre-contract body as unstructured, with today's sentence", async () => {
    const err = await rejection(
      readJson(
        new Response('{"detail":"Only admins may do that."}', { status: 403 }),
        REQUEST
      )
    );
    expect(operationsErrorReading(err)).toEqual({
      kind: "unstructured",
      sentence: "Only admins may do that.",
    });
  });

  it("passes a BackendError's own reading through", async () => {
    const err = await backendError(
      new Response(JSON.stringify({ refusal }), { status: 409 })
    );
    expect(operationsErrorReading(err)).toBe(err.reading);
  });

  it("reads any other error as unstructured with its own message", () => {
    expect(operationsErrorReading(new TypeError("Failed to fetch"))).toEqual({
      kind: "unstructured",
      sentence: "Failed to fetch",
    });
    expect(operationsErrorReading("plain")).toEqual({
      kind: "unstructured",
      sentence: "plain",
    });
  });
});
