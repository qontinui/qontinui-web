/**
 * The upstream badge rules.
 *
 * Three properties are pinned here because each one fails silently otherwise:
 *
 * 1. **The badge reads served booleans and nothing else.** Every case below
 *    passes `update_available` / `local_modified` values that a client-side
 *    body comparison could never have produced — a document flagged
 *    `update_available` while its numbers say it already tracks the latest, a
 *    document flagged clean while it tracks nothing. If a future edit starts
 *    deriving the answer from the version numbers, these break.
 * 2. **`upstream_publication_version === null` is UNKNOWN, not "diverged".**
 *    Coord degrades `local_modified` to `true` on any unresolvable digest, so
 *    every document with no upstream arrives with that flag set. Badging on the
 *    boolean alone would mark the whole store diverged.
 * 3. **A coord that predates the channel produces no badge at all.** All four
 *    fields are optional on the wire; absent is UNKNOWN, and UNKNOWN renders
 *    nothing rather than a claim.
 */

import { describe, expect, it } from "vitest";
import { upstreamBadge } from "./upstreamStatus";

describe("upstreamBadge", () => {
  it("badges an available update, and names the version being offered", () => {
    const badge = upstreamBadge({
      upstream_publication_version: 3,
      latest_publication_version: 7,
      local_modified: false,
      update_available: true,
    });
    expect(badge?.testId).toBe("update-available");
    expect(badge?.label).toBe("Update v7");
    expect(badge?.tone).toBe("attention");
    // A clean document CAN take the update, and the title says so.
    expect(badge?.title).toMatch(/matches the v3 it tracks/);
  });

  it("says a modified document is never overwritten", () => {
    const badge = upstreamBadge({
      upstream_publication_version: 3,
      latest_publication_version: 7,
      local_modified: true,
      update_available: true,
    });
    expect(badge?.testId).toBe("update-available");
    expect(badge?.title).toMatch(/never overwritten/);
  });

  it("handles an update offered to a document that tracks nothing yet", () => {
    // D3: `upstream_publication_version IS NULL` means NO UPSTREAM, and such a
    // row is offered its FIRST adoption when a publication appears.
    const badge = upstreamBadge({
      upstream_publication_version: null,
      latest_publication_version: 1,
      local_modified: true,
      update_available: true,
    });
    expect(badge?.label).toBe("Update v1");
    expect(badge?.title).toMatch(/never adopted one/);
  });

  it("badges a diverged document that has no update pending", () => {
    const badge = upstreamBadge({
      upstream_publication_version: 4,
      latest_publication_version: 4,
      local_modified: true,
      update_available: false,
    });
    expect(badge?.testId).toBe("diverged");
    expect(badge?.label).toBe("Diverged from v4");
    // Informative, not a warning: divergence is a legitimate state.
    expect(badge?.tone).toBe("muted");
  });

  it("does NOT call a document with no upstream diverged", () => {
    // Coord degrades `local_modified` to true whenever the baseline digest is
    // unresolvable, which is every document that tracks no publication. Badging
    // on the boolean alone would mark the whole store diverged.
    expect(
      upstreamBadge({
        upstream_publication_version: null,
        latest_publication_version: null,
        local_modified: true,
        update_available: false,
      })
    ).toBeNull();
  });

  it("stays silent for a clean, current document", () => {
    expect(
      upstreamBadge({
        upstream_publication_version: 9,
        latest_publication_version: 9,
        local_modified: false,
        update_available: false,
      })
    ).toBeNull();
  });

  it("stays silent when coord served none of the four fields", () => {
    // A coord predating the publication channel. Absent is UNKNOWN — there is
    // no channel to describe, so there is nothing honest to render.
    expect(upstreamBadge({})).toBeNull();
  });

  it("reads the served flag, not the version arithmetic", () => {
    // `latest === tracked` would say "nothing new" to anything deriving the
    // answer itself. Coord said otherwise, and coord is the authority — this is
    // the case that fails the moment someone re-derives the badge here.
    const badge = upstreamBadge({
      upstream_publication_version: 5,
      latest_publication_version: 5,
      local_modified: false,
      update_available: true,
    });
    expect(badge?.testId).toBe("update-available");
    expect(badge?.label).toBe("Update v5");
  });

  it("does not claim divergence from a flag it was not given", () => {
    // `local_modified` absent is UNKNOWN. It is not `false`, and it is not
    // `true` either — the badge simply has nothing to say.
    expect(
      upstreamBadge({
        upstream_publication_version: 2,
        latest_publication_version: 2,
      })
    ).toBeNull();
  });
});
