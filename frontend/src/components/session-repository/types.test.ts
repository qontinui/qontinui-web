import { describe, it, expect } from "vitest";
import {
  digestClaim,
  digestClaimAgreesWithServer,
  isDeclaredTenant,
  relaunchOperation,
  resolveRelaunchTier,
  SESSION_TENANT_SOURCES,
  TENANT_SOURCE_LABELS,
  RELAUNCH_TIER_COPY,
  type RelaunchTier,
  type SessionArtifactSummary,
} from "./types";

/**
 * The three correctness requirements of plan
 * `2026-08-26-claude-code-session-repository-in-qontinui-web` Phase 5, pinned
 * at the only place they are decided.
 *
 * All three are pure functions on purpose: the chips, the panel and the
 * detail header all route through them, so a regression here is a regression
 * everywhere, and one test file covers all of it.
 */

type Provenance = Pick<SessionArtifactSummary, "device_id" | "restore_tier">;

const OWN_DEVICE = "11111111-1111-1111-1111-111111111111";
const OTHER_DEVICE = "22222222-2222-2222-2222-222222222222";

const session = (over: Partial<Provenance> = {}): Provenance => ({
  device_id: OWN_DEVICE,
  restore_tier: "full",
  ...over,
});

// ───────────── §3.5 — relaunch and transfer are different operations ────────

describe("resolveRelaunchTier", () => {
  it("a resume onto the session's own machine is the full tier", () => {
    expect(
      resolveRelaunchTier(session(), {
        mode: "resume",
        targetDeviceId: OWN_DEVICE,
      })
    ).toBe<RelaunchTier>("full");
  });

  it("a resume onto a different machine needs the archive to get there", () => {
    expect(
      resolveRelaunchTier(session(), {
        mode: "resume",
        targetDeviceId: OTHER_DEVICE,
      })
    ).toBe<RelaunchTier>("full_after_restore");
  });

  it("a TRANSFER is replay-as-context, never a resume", () => {
    const tier = resolveRelaunchTier(session(), {
      mode: "transfer",
      targetDeviceId: OWN_DEVICE,
    });
    expect(tier).toBe<RelaunchTier>("replay_as_context");
    // The operation — not just the label — has to change.
    expect(relaunchOperation(tier)).toBe("transfer");
  });

  it("a transfer stays a transfer even on the session's own machine", () => {
    expect(
      resolveRelaunchTier(session(), {
        mode: "transfer",
        targetDeviceId: OWN_DEVICE,
      })
    ).toBe<RelaunchTier>("replay_as_context");
  });

  it("the runner's terminal_only observation caps every resume", () => {
    expect(
      resolveRelaunchTier(session({ restore_tier: "terminal_only" }), {
        mode: "resume",
        targetDeviceId: OWN_DEVICE,
      })
    ).toBe<RelaunchTier>("terminal_only");
    expect(
      resolveRelaunchTier(session({ restore_tier: "terminal_only" }), {
        mode: "resume",
        targetDeviceId: OTHER_DEVICE,
      })
    ).toBe<RelaunchTier>("terminal_only");
  });

  it("terminal_only does NOT turn a transfer into a resume tier", () => {
    expect(
      resolveRelaunchTier(session({ restore_tier: "terminal_only" }), {
        mode: "transfer",
        targetDeviceId: OWN_DEVICE,
      })
    ).toBe<RelaunchTier>("replay_as_context");
  });

  it("an unrecorded owning device is unknown, not optimistically full", () => {
    expect(
      resolveRelaunchTier(session({ device_id: null }), {
        mode: "resume",
        targetDeviceId: OTHER_DEVICE,
      })
    ).toBe<RelaunchTier>("unknown");
    expect(
      resolveRelaunchTier(session(), {
        mode: "resume",
        targetDeviceId: "",
      })
    ).toBe<RelaunchTier>("unknown");
  });

  it("only the transfer tier is typed as a transfer", () => {
    const tiers: RelaunchTier[] = [
      "full",
      "full_after_restore",
      "terminal_only",
      "replay_as_context",
      "unknown",
    ];
    for (const tier of tiers) {
      expect(relaunchOperation(tier)).toBe(
        tier === "replay_as_context" ? "transfer" : "resume"
      );
    }
  });

  it("no resume tier's copy calls a transfer a resume, and vice versa", () => {
    expect(RELAUNCH_TIER_COPY.replay_as_context.action.toLowerCase()).not.toContain(
      "resume"
    );
    expect(RELAUNCH_TIER_COPY.replay_as_context.badge).toContain("NOT a resume");
    expect(RELAUNCH_TIER_COPY.full.action.toLowerCase()).toContain("resume");
  });
});

// ───────── §3.6 rule 2 — a guessed tenant never reads like a declared one ───

describe("tenant attribution", () => {
  it("declared is the ONLY source that counts as an assertion", () => {
    for (const source of SESSION_TENANT_SOURCES) {
      expect(isDeclaredTenant(source)).toBe(source === "declared");
    }
  });

  it("an unrecognised source is not treated as declared", () => {
    expect(isDeclaredTenant("something_new")).toBe(false);
  });

  it("every weak source states its weakness in the label text itself", () => {
    for (const source of SESSION_TENANT_SOURCES) {
      const label = TENANT_SOURCE_LABELS[source].toLowerCase();
      if (source === "declared") {
        expect(label).toContain("declared");
        continue;
      }
      // Colour and icon are not the only channel: the word survives a
      // screenshot, a colour-blind reader and a monochrome print.
      expect(
        label.includes("guessed") ||
          label.includes("ambiguous") ||
          label.includes("unknown")
      ).toBe(true);
      expect(label).not.toContain("declared");
    }
  });
});

// ───────── §5 — a redacted body's digest is never presented as verified ─────

describe("digestClaim", () => {
  it("a verbatim body's digest verifies against the original file", () => {
    const claim = digestClaim("disk_verbatim", "a".repeat(64));
    expect(claim.kind).toBe("verifiable");
    expect(claim.detail).toContain("verifies against the original");
  });

  it("a coord_redacted digest is labelled NOT verifiable", () => {
    const claim = digestClaim("coord_redacted", "b".repeat(64));
    expect(claim.kind).toBe("unverifiable_redacted");
    expect(claim.label).toContain("NOT verifiable");
    expect(claim.detail).toContain("cannot be checked against it");
  });

  it("no digest is metadata-only, not a silent pass", () => {
    expect(digestClaim("disk_verbatim", null).kind).toBe("no_body");
    expect(digestClaim(null, null).kind).toBe("no_body");
  });

  it("a digest with no recorded source is unknown provenance, not verified", () => {
    const claim = digestClaim(null, "c".repeat(64));
    expect(claim.kind).toBe("provenance_unknown");
    expect(claim.detail).toContain("unverified");
  });

  it("only the verifiable claim may use the word 'verifies'", () => {
    const sources = [null, "disk_verbatim", "coord_redacted", "future_source"];
    for (const source of sources) {
      const claim = digestClaim(source, "d".repeat(64));
      const saysVerifies = claim.detail.includes("verifies against the original");
      expect(saysVerifies).toBe(source === "disk_verbatim");
    }
  });

  it("agrees with the server's own digest_verifiable flag", () => {
    const verbatim = digestClaim("disk_verbatim", "e".repeat(64));
    const redacted = digestClaim("coord_redacted", "f".repeat(64));
    expect(digestClaimAgreesWithServer(verbatim, true)).toBe(true);
    expect(digestClaimAgreesWithServer(redacted, false)).toBe(true);
    // A contradiction is reported, never resolved toward the nicer answer.
    expect(digestClaimAgreesWithServer(redacted, true)).toBe(false);
    expect(digestClaimAgreesWithServer(verbatim, false)).toBe(false);
    // No server flag is UNKNOWN, not agreement.
    expect(digestClaimAgreesWithServer(verbatim, null)).toBeNull();
  });
});
