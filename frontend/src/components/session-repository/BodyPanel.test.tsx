/**
 * The export's integrity check must never grade itself.
 *
 * `runExport` re-hashes the downloaded bytes and compares them against the
 * digest THE ARCHIVE RECORDED. The one value it may never compare against is
 * `X-Content-Sha256` — the digest the server computed from the very bytes
 * being checked. That comparison is a tautology: it passes for any response
 * the server can produce, and the panel reports it as "the downloaded bytes
 * hash to the recorded digest — the stored copy is intact".
 *
 * The panel used to do exactly that, via `artifact.content_sha256 ??
 * body.servedSha256`. It was invisible for as long as it was unreachable:
 * `X-Content-Sha256` is not CORS-safelisted, so a cross-origin browser read
 * `null` for it and the `??` fallback never fired in the deployed shape.
 * #1177 added the header to `Access-Control-Expose-Headers` — correctly — and
 * in doing so made the fallback live in production for the first time. A row
 * with a body and no recorded digest began rendering a green pass while the
 * same response carried `X-Content-Sha256-Stored: none` and
 * `X-Content-Sha256-Match: false`.
 *
 * So the first test here is the one that would have caught it, and it is
 * written to fail against the old code specifically: the row has NO
 * `content_sha256`, and the response carries a served digest that matches the
 * body perfectly.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { getBaseUrl: () => "https://api.example.test" },
}));

import { BodyPanel } from "./BodyPanel";
import type { SessionArtifactSummary } from "./types";

/** The JSONL every response in this file serves, and its real SHA-256. */
const BODY = '{"type":"user","text":"hello"}\n';
const BODY_SHA =
  "5e8bbd4a2f3e0f8e0f39a8a2b1ee2b8b7f4b3f1c8a9d0e2f6c7a1b3d5e7f9a0b";

/**
 * A stand-in for WebCrypto that returns the digest we tell it to.
 *
 * The point of these tests is WHICH value the panel compares against, not
 * whether SHA-256 is implemented correctly, and pinning a real digest of a
 * literal would make the file fail for the wrong reason if the fixture ever
 * changed by a byte.
 */
function stubDigest(hex: string) {
  const bytes = new Uint8Array(
    (hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16))
  );
  vi.stubGlobal("crypto", {
    subtle: { digest: vi.fn().mockResolvedValue(bytes.buffer) },
  });
}

function exportResponse(headers: Record<string, string>): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    text: async () => BODY,
  } as unknown as Response;
}

function summary(
  overrides: Partial<SessionArtifactSummary> = {}
): SessionArtifactSummary {
  return {
    id: "0f2f6a1e-1a9b-4c1e-9a3d-7c4c1f0f2b55",
    claude_session_id: "730de490-7632-4884-a42b-0cb9aedd6791",
    // The shape under test: bytes ARE archived, but no digest was recorded.
    content_sha256: null,
    body_object_key: "sessions/730de490.jsonl",
    body_source: "disk_verbatim",
    byte_count: BODY.length,
    turn_count: 1,
    secret_finding_count: 0,
    secret_finding_kinds: null,
    ...overrides,
  } as SessionArtifactSummary;
}

beforeEach(() => {
  fetchMock.mockReset();
  // jsdom has no anchor-driven download; the panel calls it after the check.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stub");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BodyPanel integrity check", () => {
  it("reports UNCHECKABLE when the archive recorded no digest, even though the served digest matches", async () => {
    // The regression. Every value here is what a healthy server sends for a
    // row with no recorded digest, and the served digest agrees with the body
    // exactly — so any code that falls back to it renders a green pass.
    stubDigest(BODY_SHA);
    fetchMock.mockResolvedValue(
      exportResponse({
        "X-Content-Sha256": BODY_SHA,
        "X-Content-Sha256-Stored": "none",
        "X-Content-Sha256-Match": "false",
        "X-Digest-Verifiable": "false",
        "X-Body-Source": "disk_verbatim",
      })
    );

    render(<BodyPanel artifact={summary()} />);
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result).toHaveAttribute("data-integrity", "uncheckable");
    expect(result.textContent).toContain("recorded no digest");
    // The specific lie this test exists to prevent.
    expect(result.textContent).not.toContain("stored copy is intact");
  });

  it("checks against X-Content-Sha256-Stored, not the summary row", async () => {
    // The header is the fresher of the two: the server read it from the
    // archive while serving these bytes. A stale summary must not override it.
    const archived = "a".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(
      exportResponse({
        "X-Content-Sha256": BODY_SHA,
        "X-Content-Sha256-Stored": archived,
        "X-Content-Sha256-Match": "true",
        "X-Digest-Verifiable": "true",
        "X-Body-Source": "disk_verbatim",
      })
    );

    render(
      <BodyPanel artifact={summary({ content_sha256: "b".repeat(64) })} />
    );
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result).toHaveAttribute("data-integrity", "match");
  });

  it("falls back to the summary row when the header is unreadable", async () => {
    // An older backend, or a CORS exposure that regressed. The row's digest is
    // a real recorded value, so the check still runs — it is only the SERVED
    // digest that may never stand in.
    const archived = "c".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(exportResponse({}));

    render(<BodyPanel artifact={summary({ content_sha256: archived })} />);
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result).toHaveAttribute("data-integrity", "match");
  });

  it("reports UNCHECKABLE when neither the header nor the row has a digest", async () => {
    stubDigest(BODY_SHA);
    fetchMock.mockResolvedValue(exportResponse({}));

    render(<BodyPanel artifact={summary()} />);
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result).toHaveAttribute("data-integrity", "uncheckable");
  });

  it("reports a MISMATCH when the download disagrees with the recorded digest", async () => {
    const archived = "d".repeat(64);
    stubDigest("e".repeat(64));
    fetchMock.mockResolvedValue(
      exportResponse({
        "X-Content-Sha256": "e".repeat(64),
        "X-Content-Sha256-Stored": archived,
        "X-Content-Sha256-Match": "false",
        "X-Digest-Verifiable": "true",
      })
    );

    render(<BodyPanel artifact={summary()} />);
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result).toHaveAttribute("data-integrity", "mismatch");
  });

  it("says so when the server's own verdict contradicts the local re-hash", async () => {
    // The server compared served-vs-stored and said NO; re-hashing here says
    // yes. Silently preferring either answer would hide a real disagreement.
    const archived = "f".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(
      exportResponse({
        "X-Content-Sha256": BODY_SHA,
        "X-Content-Sha256-Stored": archived,
        "X-Content-Sha256-Match": "false",
        "X-Digest-Verifiable": "true",
      })
    );

    render(<BodyPanel artifact={summary()} />);
    await userEvent.click(screen.getByTestId("session-export"));

    await waitFor(() =>
      expect(
        screen.getByTestId("session-export-server-disagreement")
      ).toBeInTheDocument()
    );
  });

  it("stays silent when the server's verdict agrees", async () => {
    const archived = "1".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(
      exportResponse({
        "X-Content-Sha256": archived,
        "X-Content-Sha256-Stored": archived,
        "X-Content-Sha256-Match": "true",
        "X-Digest-Verifiable": "true",
      })
    );

    render(<BodyPanel artifact={summary()} />);
    await userEvent.click(screen.getByTestId("session-export"));

    await screen.findByTestId("session-export-integrity");
    expect(
      screen.queryByTestId("session-export-server-disagreement")
    ).toBeNull();
  });

  it("describes the SERVED bytes, not a stale summary row", async () => {
    // The row says the body is the verbatim file; the response says these are
    // coord's redacted bytes. Trusting the row would print "that digest is
    // also the original file's" about a redacted copy — the single claim this
    // whole panel exists to never make.
    const archived = "3".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(
      exportResponse({
        "X-Content-Sha256-Stored": archived,
        "X-Content-Sha256-Match": "true",
        "X-Digest-Verifiable": "false",
        "X-Body-Source": "coord_redacted",
      })
    );

    render(<BodyPanel artifact={summary({ body_source: "disk_verbatim" })} />);
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result.textContent).toContain("coord's redacted bytes");
    expect(result.textContent).not.toContain("also the original file's");
  });

  it("only claims the digest covers the original on an explicit verifiable=true", async () => {
    const archived = "4".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(
      exportResponse({
        "X-Content-Sha256-Stored": archived,
        "X-Content-Sha256-Match": "true",
        "X-Digest-Verifiable": "true",
        "X-Body-Source": "disk_verbatim",
      })
    );

    render(<BodyPanel artifact={summary()} />);
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result.textContent).toContain("also the original file's");
  });

  it("says UNKNOWN, not a second pass, when verifiability is unreadable", async () => {
    // No X-Digest-Verifiable. The row alone must not promote the download to
    // "verified against the original" — absence is not a yes.
    const archived = "5".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(
      exportResponse({ "X-Content-Sha256-Stored": archived })
    );

    render(<BodyPanel artifact={summary({ body_source: "disk_verbatim" })} />);
    await userEvent.click(screen.getByTestId("session-export"));

    const result = await screen.findByTestId("session-export-integrity");
    expect(result).toHaveAttribute("data-integrity", "match");
    expect(result.textContent).not.toContain("also the original file's");
    expect(result.textContent).toContain("not established here");
  });

  it("does not claim a disagreement when the server's verdict is unreadable", async () => {
    // An absent X-Content-Sha256-Match is UNKNOWN, not "false". Treating it as
    // a verdict would manufacture a contradiction on every older backend.
    const archived = "2".repeat(64);
    stubDigest(archived);
    fetchMock.mockResolvedValue(
      exportResponse({ "X-Content-Sha256-Stored": archived })
    );

    render(<BodyPanel artifact={summary()} />);
    await userEvent.click(screen.getByTestId("session-export"));

    await screen.findByTestId("session-export-integrity");
    expect(
      screen.queryByTestId("session-export-server-disagreement")
    ).toBeNull();
  });
});
