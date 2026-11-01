import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the verification-metrics client sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchLabelSample, fetchVerificationMetrics, recordOperatorLabel } =
  await import("./coordVerification");

const VID = "5f0c2a8e-7d1b-4c3e-9a40-1b2c3d4e5f60";
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status });

const RECORD = {
  id: "0d6a1f3e-1111-4c3e-9a40-1b2c3d4e5f60",
  label_source: "operator",
  verification_id: VID,
  seed_class: null,
  truth: "holds",
  verifier_verdict: "refuted",
  labelled_by: "operator:abc",
  created_at: "2026-11-01T12:00:00Z",
};

/** The web backend's refusal envelope, as production renders a 5xx it raised. */
const webRefusal = (discriminator: string, status: number) =>
  json(
    {
      error: "upstream_unavailable",
      message: "m",
      refusal: { discriminator },
    },
    status
  );

describe("recordOperatorLabel", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("POSTs only the operator label body, and a 201 is the recorded row", async () => {
    const record = RECORD;
    fetchMock.mockResolvedValueOnce(json(record, 201));
    await expect(recordOperatorLabel(VID, "holds")).resolves.toEqual({
      kind: "recorded",
      record,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/operations/coord/verification/labels");
    expect(init.method).toBe("POST");
    expect(init.idempotent).toBe(false);
    expect(JSON.parse(init.body)).toEqual({
      label_source: "operator",
      verification_id: VID,
      truth: "holds",
    });
  });

  it("a 409 duplicate_label is 'already labelled', naming the existing row", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "duplicate_label", message: "m", id: "existing" }, 409)
    );
    await expect(recordOperatorLabel(VID, "fails")).resolves.toEqual({
      kind: "already_labelled",
      existingId: "existing",
    });
  });

  it("a 409 for any other reason is rejected, not 'already labelled'", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "something_else", message: "busy" }, 409)
    );
    await expect(recordOperatorLabel(VID, "fails")).resolves.toEqual({
      kind: "rejected",
      status: 409,
      code: "something_else",
      message: "busy",
    });
  });

  it("a 422 is rejected — definitely not recorded", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "invalid_truth", message: "no" }, 422)
    );
    await expect(recordOperatorLabel(VID, "holds")).resolves.toEqual({
      kind: "rejected",
      status: 422,
      code: "invalid_truth",
      message: "no",
    });
  });

  it("the web's own 502s that never reached coord, or were refused, are rejected", async () => {
    for (const d of [
      "coord_unreachable",
      "coord_verification_label_credential_refused",
    ]) {
      fetchMock.mockResolvedValueOnce(webRefusal(d, 502));
      await expect(recordOperatorLabel(VID, "holds")).resolves.toEqual({
        kind: "rejected",
        status: 502,
        code: "upstream_unavailable",
        message: "m",
      });
    }
  });

  it("a 403 is refused, with coord's code", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { error: "operator_principal_required", message: "operators only" },
        403
      )
    );
    await expect(recordOperatorLabel(VID, "cannot_tell")).resolves.toEqual({
      kind: "refused",
      code: "operator_principal_required",
      message: "operators only",
    });
  });

  it("a 404 is not_found — coord's verification_not_found, or an absent door", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "verification_not_found", message: "no such verdict" }, 404)
    );
    await expect(recordOperatorLabel(VID, "holds")).resolves.toEqual({
      kind: "not_found",
      code: "verification_not_found",
      message: "no such verdict",
    });
    fetchMock.mockResolvedValueOnce(json({ detail: "Not Found" }, 404));
    await expect(recordOperatorLabel(VID, "holds")).resolves.toEqual({
      kind: "not_found",
      code: null,
      message: "Not Found",
    });
  });

  it("a 504, any other 5xx and no answer at all are unknown", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "coord timed out" }, 504));
    await expect(recordOperatorLabel(VID, "holds")).resolves.toEqual({
      kind: "unknown",
      status: 504,
      message: "coord timed out",
    });
    fetchMock.mockResolvedValueOnce(webRefusal("coord_read_answer_lost", 502));
    expect((await recordOperatorLabel(VID, "holds")).kind).toBe("unknown");
    fetchMock.mockResolvedValueOnce(json({ error: "store" }, 503));
    expect((await recordOperatorLabel(VID, "holds")).kind).toBe("unknown");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const none = await recordOperatorLabel(VID, "holds");
    expect(none).toMatchObject({ kind: "unknown", status: null });
    if (none.kind === "unknown") {
      expect(none.message).toContain("may or may not have been recorded");
    }
  });

  it("a 201 that is not the requested row is unknown", async () => {
    const bad = [
      "",
      JSON.stringify({ ...RECORD, verification_id: "another" }),
      JSON.stringify({ ...RECORD, truth: "yes" }),
      JSON.stringify({ ...RECORD, verifier_verdict: "maybe" }),
      JSON.stringify({ ...RECORD, id: 7 }),
    ];
    for (const body of bad) {
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 201 }));
      const r = await recordOperatorLabel(VID, "holds");
      expect(r).toMatchObject({ kind: "unknown", status: 201 });
    }
    // The id comparison ignores case.
    fetchMock.mockResolvedValueOnce(json(RECORD, 201));
    expect((await recordOperatorLabel(VID.toUpperCase(), "holds")).kind).toBe(
      "recorded"
    );
  });
});

describe("fetchLabelSample", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("GETs the sample door; a 200 is answered with coord's body", async () => {
    const body = { iso_week: "2026-W44", verdicts: [] };
    fetchMock.mockResolvedValueOnce(json(body, 200));
    await expect(fetchLabelSample()).resolves.toEqual({
      kind: "answered",
      body,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/verification/label-sample",
      { method: "GET", idempotent: true },
    ]);
  });

  it("a 404, a 503 and no answer are unavailable, never an empty sample", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "Not Found" }, 404));
    await expect(fetchLabelSample()).resolves.toEqual({
      kind: "unavailable",
      status: 404,
      code: null,
      message: "Not Found",
    });
    fetchMock.mockResolvedValueOnce(
      json({ error: "label_sample_unreadable", message: "store down" }, 503)
    );
    await expect(fetchLabelSample()).resolves.toEqual({
      kind: "unavailable",
      status: 503,
      code: "label_sample_unreadable",
      message: "store down",
    });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetchLabelSample()).resolves.toEqual({
      kind: "unavailable",
      status: null,
      code: null,
      message: "Failed to fetch",
    });
  });
});

describe("coordVerification", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchVerificationMetrics GETs the window, encoded", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ degraded: false }))
    );
    await expect(fetchVerificationMetrics("28d")).resolves.toEqual({
      degraded: false,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/verification/metrics?window=28d",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchVerificationMetrics keeps a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"detail":"coord is not reachable"}', { status: 502 })
    );
    await expect(fetchVerificationMetrics("7d")).rejects.toThrow(
      'GET /api/v1/operations/coord/verification/metrics?window=7d failed: 502 - {"detail":"coord is not reachable"}'
    );
  });
});
