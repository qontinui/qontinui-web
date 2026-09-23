/**
 * Unit tests for the `/admin/coord/findings` derivations.
 *
 * Plan `2026-09-15-the-console-names-a-finding-it-cannot-open`, Phase 2.
 *
 * The three properties worth pinning, because each is a claim the page makes
 * on screen and each was wrong in an obvious first draft:
 *
 *  - a DOSSIER HEAD is not "expiring". Its TTL is a hundred years, so any
 *    classifier that reports a countdown reports one for every durable row in
 *    the store;
 *  - an EXPIRED row is FOUND, not missing — coord serves a by-id read past
 *    `expires_at`, and the banner has to say so rather than fall through to
 *    "no such finding";
 *  - `loading` OUTRANKS the not-found arm, so the first render of a deep link
 *    cannot tell the operator his finding does not exist.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";

import {
  type CoordFindingRow,
  DURABLE_HORIZON_MS,
  FINDING_ATTENTION_BY_RETENTION,
  FINDING_STATUS_PALETTE,
  deriveFindingStatus,
  deriveFindingsHealth,
  dossierSlug,
  findingHref,
  findingLinkNotice,
  isExpired,
  isFindingId,
  linkedRowFrom,
  retentionOf,
  triageFilterCaveat,
  triageOf,
  triageSentence,
} from "./findingStatus";

const NOW = Date.parse("2026-09-18T12:00:00Z");

function row(over: Partial<CoordFindingRow> = {}): CoordFindingRow {
  return {
    finding_id: "fec41291-67ed-4cf8-b331-888ad1126b45",
    title: "A created document sends no notice",
    body: "The console printed the uuid and nothing could open it.",
    kind: "observation",
    topic: "prompt-documents",
    scope: "tenant",
    resource_keys: ["repo:qontinui-web"],
    artifact_refs: null,
    author_session: "session:9f1e",
    created_at: "2026-09-15T09:00:00Z",
    expires_at: "2026-09-29T09:00:00Z",
    triaged_at: null,
    triaged_by: null,
    supersedes: null,
    tenant_id: null,
    ...over,
  };
}

describe("retentionOf", () => {
  it("classifies a fortnight-long finding as in-retention", () => {
    expect(retentionOf(row(), NOW)).toBe("expiring");
  });

  it("classifies a DOSSIER HEAD as durable, not as expiring", () => {
    // The whole point. A dossier head carries a 100-year TTL, so a classifier
    // that keyed on "has an expiry" would put every durable row in the store
    // on a countdown.
    const head = row({ kind: "dossier", expires_at: "2126-09-15T09:00:00Z" });
    expect(retentionOf(head, NOW)).toBe("durable");
    expect(isExpired(head, NOW)).toBe(false);
  });

  it("keys on the DISTANCE, not on the kind", () => {
    // Mutation: a durable expiry on a row that is NOT a dossier is still
    // durable, and a fortnight-long expiry on a row that IS one is not. A
    // `kind === "dossier"` predicate fails both halves, and it would also put
    // the enum in the derivation R8 keeps it out of.
    expect(retentionOf({ expires_at: "2126-09-15T09:00:00Z" }, NOW)).toBe(
      "durable"
    );
    expect(
      retentionOf(
        { expires_at: new Date(NOW + 5 * 86_400_000).toISOString() },
        NOW
      )
    ).toBe("expiring");
  });

  it("puts the boundary exactly at the durable horizon", () => {
    expect(
      retentionOf(
        { expires_at: new Date(NOW + DURABLE_HORIZON_MS).toISOString() },
        NOW
      )
    ).toBe("durable");
    expect(
      retentionOf(
        { expires_at: new Date(NOW + DURABLE_HORIZON_MS - 1000).toISOString() },
        NOW
      )
    ).toBe("expiring");
  });

  it("calls a lapsed expiry expired, and the boundary is inclusive", () => {
    expect(retentionOf({ expires_at: "2026-09-01T00:00:00Z" }, NOW)).toBe(
      "expired"
    );
    expect(retentionOf({ expires_at: new Date(NOW).toISOString() }, NOW)).toBe(
      "expired"
    );
  });

  it("reads an absent or unparseable expiry as UNKNOWN, never as permanent", () => {
    // `silent-empty-is-unknown`, applied to a timestamp. Calling a missing
    // expiry "never expires" would be the most reassuring possible reading of
    // a field the store declined to serve.
    expect(retentionOf({ expires_at: null }, NOW)).toBe("unknown");
    expect(retentionOf({ expires_at: undefined }, NOW)).toBe("unknown");
    expect(retentionOf({ expires_at: "not a date" }, NOW)).toBe("unknown");
  });
});

describe("deriveFindingStatus", () => {
  it("renders a LABEL, never the retention enum", () => {
    const status = deriveFindingStatus(row(), NOW);
    expect(status.kind).toBe("expiring");
    expect(status.label).not.toBe("expiring");
    expect(status.label).toMatch(/retention/i);
    expect(status.reason).toBeTruthy();
  });

  it("says a durable row is KEPT rather than counting down", () => {
    const status = deriveFindingStatus(
      row({ expires_at: "2126-09-15T09:00:00Z" }),
      NOW
    );
    expect(status.label).toMatch(/kept/i);
    expect(status.label).not.toMatch(/expir/i);
  });

  it("gives an expired row a calm attention — it is a fact, not a demand", () => {
    // R3: nothing on a reader is red or amber-for-backlog. What the expired
    // row owes the operator is a SENTENCE, and it has one.
    const status = deriveFindingStatus(
      row({ expires_at: "2026-09-01T00:00:00Z" }),
      NOW
    );
    expect(status.attention).toBe("none");
    expect(status.reason).toMatch(/still readable by id/i);
  });

  it("floors an unknown retention at amber, never at calm", () => {
    expect(deriveFindingStatus(row({ expires_at: null }), NOW).attention).toBe(
      "waiting"
    );
  });
});

describe("the R3 palette", () => {
  it("agrees with the attention table", () => {
    expect(
      paletteDisagreements(
        FINDING_ATTENTION_BY_RETENTION,
        FINDING_STATUS_PALETTE
      )
    ).toEqual([]);
  });

  it("claims no row on this surface as somebody's action", () => {
    // A reader demands nothing. If a future kind ever does, this assertion is
    // the place that forces the argument rather than letting a red badge
    // appear by accident.
    expect(FINDING_STATUS_PALETTE.authorGlyphKinds.size).toBe(0);
  });
});

describe("dossierSlug / triageOf / triageSentence", () => {
  it("reads the slug the findings steward wrote", () => {
    expect(
      dossierSlug(row({ artifact_refs: { dossier_slug: "worktree-siblings" } }))
    ).toBe("worktree-siblings");
  });

  it("treats a blank or non-string slug as NO route", () => {
    expect(
      dossierSlug(row({ artifact_refs: { dossier_slug: "  " } }))
    ).toBeNull();
    expect(dossierSlug(row({ artifact_refs: { dossier_slug: 7 } }))).toBeNull();
    expect(dossierSlug(row({ artifact_refs: {} }))).toBeNull();
    expect(dossierSlug(row({ artifact_refs: null }))).toBeNull();
  });

  it("ranks routed above triaged above untriaged", () => {
    expect(
      triageOf(
        row({
          artifact_refs: { dossier_slug: "worktree-siblings" },
          triaged_at: "2026-09-16T00:00:00Z",
        })
      )
    ).toBe("routed");
    expect(triageOf(row({ triaged_at: "2026-09-16T00:00:00Z" }))).toBe(
      "triaged"
    );
    expect(triageOf(row())).toBe("untriaged");
  });

  it("names the dossier and the steward in one sentence", () => {
    const line = triageSentence(
      row({
        artifact_refs: { dossier_slug: "worktree-siblings" },
        triaged_at: "2026-09-16T00:00:00Z",
        triaged_by: "findings-steward",
      })
    );
    expect(line).toMatch(/worktree-siblings/);
    expect(line).toMatch(/findings-steward/);
  });

  it("distinguishes 'read and left to expire' from 'not read yet'", () => {
    expect(triageSentence(row({ triaged_at: "2026-09-16T00:00:00Z" }))).toMatch(
      /left to expire/i
    );
    expect(triageSentence(row())).toMatch(/not yet read/i);
  });
});

describe("triageFilterCaveat", () => {
  it("explains the narrowing ONLY under untriaged-only", () => {
    // Two numbers that disagree with no sentence between them is the defect.
    const line = triageFilterCaveat(false);
    expect(line).toMatch(/dossier heads/i);
    expect(line).toMatch(/other tenants/i);
    expect(triageFilterCaveat(true)).toBeNull();
    expect(triageFilterCaveat(null)).toBeNull();
  });
});

describe("findingHref", () => {
  it("is the deep link the landed-write feed points at", () => {
    expect(findingHref("abc-123")).toBe("/admin/coord/findings?id=abc-123");
    expect(findingHref("a b/c")).toBe("/admin/coord/findings?id=a%20b%2Fc");
  });
});

describe("findingLinkNotice", () => {
  it("does NOT say 'not found' on the first render", () => {
    // `loading` outranks the fallback and short-circuits. The operator arrived
    // by clicking a link; telling him it is missing before anything was
    // fetched is the unknown-reported-as-fact failure this banner exists to
    // avoid.
    const line = findingLinkNotice({ found: false, loading: true });
    expect(line).toMatch(/looking for/i);
    expect(line).not.toMatch(/no finding/i);
    expect(line).not.toMatch(/another tenant/i);
  });

  it("outranks loading with found — the row is on screen", () => {
    expect(findingLinkNotice({ found: true, loading: true })).toMatch(
      /expanded below/i
    );
  });

  it("keeps EXPIRED and NOT FOUND as distinct arms", () => {
    // The mutation that matters: an expired row IS found. Folding the two
    // would report a row the operator can read, one element below, as one
    // that does not exist.
    const expired = findingLinkNotice({
      found: true,
      expired: true,
      loading: false,
    });
    const missing = findingLinkNotice({ found: false, loading: false });
    expect(expired).toMatch(/expanded below/i);
    expect(expired).toMatch(/past its retention window/i);
    expect(missing).not.toMatch(/expanded below/i);
    expect(missing).toMatch(/another tenant/i);
    expect(expired).not.toEqual(missing);
  });

  it("does not call a live row expired", () => {
    const live = findingLinkNotice({
      found: true,
      expired: false,
      loading: false,
    });
    expect(live).toMatch(/expanded below/i);
    expect(live).not.toMatch(/retention window/i);
  });

  it("blames the read, not the id, when the look-up failed", () => {
    const line = findingLinkNotice({
      found: false,
      loading: false,
      error: true,
    });
    expect(line).toMatch(/read failed/i);
    expect(line).not.toMatch(/another tenant/i);
  });

  it("outranks every failure arm with unavailability", () => {
    // With no findings surface there is no store for the id to be absent
    // FROM, so "no such finding" would report a deployment state as a fact
    // about this id.
    const line = findingLinkNotice({
      found: false,
      loading: false,
      error: true,
      unavailable: true,
    });
    expect(line).toMatch(/availability state/i);
    expect(line).not.toMatch(/another tenant/i);
  });

  it("names a malformed link first, above every other arm", () => {
    // A mangled id was never looked up, so found / loading / failed / absent
    // are all claims about a read that did not happen.
    for (const state of [
      { found: false, loading: true },
      { found: false, loading: false, error: true },
      { found: false, loading: false, unavailable: true },
      { found: false, loading: false },
    ]) {
      const line = findingLinkNotice({ ...state, invalid: true });
      expect(line).toMatch(/not a finding id/i);
      expect(line).not.toMatch(/looking for|read failed|another tenant/i);
    }
    expect(findingLinkNotice({ found: false, loading: false })).not.toMatch(
      /not a finding id/i
    );
  });

  it("says a failed read can be retried from the refresh control", () => {
    expect(
      findingLinkNotice({ found: false, loading: false, error: true })
    ).toMatch(/refresh to retry/i);
  });

  it("names a superseded head among the not-found explanations", () => {
    // The by-id read keeps hiding a head that a correction superseded; the
    // sentence must not claim the id belongs to another tenant or to nothing.
    expect(findingLinkNotice({ found: false, loading: false })).toMatch(
      /superseded by a correction/i
    );
  });

  it("explains a linked row that the filters exclude, and only then", () => {
    const outside = findingLinkNotice({
      found: true,
      loading: false,
      outsideFilters: true,
    });
    expect(outside).toMatch(/expanded below/i);
    expect(outside).toMatch(/outside the current filters/i);
    expect(
      findingLinkNotice({ found: true, loading: false, outsideFilters: false })
    ).not.toMatch(/outside the current filters/i);
  });

  it("never claims 'outside the filters' for a row beyond a full page", () => {
    const beyond = findingLinkNotice({
      found: true,
      loading: false,
      beyondLoadedPage: true,
    });
    expect(beyond).toMatch(/not in the loaded page/i);
    expect(beyond).not.toMatch(/outside the current filters/i);
  });
});

describe("isFindingId", () => {
  it("accepts a uuid in either case, trimmed, and nothing else", () => {
    expect(isFindingId("fec41291-67ed-4cf8-b331-888ad1126b45")).toBe(true);
    expect(isFindingId(" FEC41291-67ED-4CF8-B331-888AD1126B45 ")).toBe(true);
    expect(isFindingId("fec41291")).toBe(false);
    expect(isFindingId("not-a-uuid")).toBe(false);
    expect(isFindingId("")).toBe(false);
  });
});

describe("linkedRowFrom", () => {
  const A = "fec41291-67ed-4cf8-b331-888ad1126b45";
  const B = "0f4d1a2b-6c8e-4f10-9a33-2b7c5d8e1f90";

  it("returns the row that IS the id, case-insensitively", () => {
    expect(
      linkedRowFrom([{ finding_id: B }, { finding_id: A }], A.toUpperCase())
    ).toEqual({ finding_id: A });
  });

  it("returns null when the page carries only OTHER rows", () => {
    // A door that ignored `finding_id` still answers with a well-formed page.
    expect(linkedRowFrom([{ finding_id: B }], A)).toBeNull();
    expect(linkedRowFrom([], A)).toBeNull();
  });
});

describe("deriveFindingsHealth", () => {
  const base = {
    count: 4,
    loaded: true,
    failed: false,
    unavailable: null,
    triaged: null,
  };

  it("is green and quotes the count once a read has landed", () => {
    const h = deriveFindingsHealth(base);
    expect(h.level).toBe("green");
    expect(h.headline).toMatch(/4 findings/);
    expect(h.badges[0].label).toBe("4 shown");
    expect(h.readIsCurrent).toBe(true);
  });

  it("is never red — nothing on a reader is a demand", () => {
    for (const input of [
      base,
      { ...base, failed: true },
      { ...base, loaded: false },
      { ...base, unavailable: "coord did not answer" },
    ]) {
      expect(deriveFindingsHealth(input).level).not.toBe("red");
    }
  });

  it("dashes the count rather than zeroing it in every not-known state", () => {
    for (const input of [
      { ...base, count: null, loaded: false },
      { ...base, failed: true },
      { ...base, unavailable: "coord did not answer" },
    ]) {
      const h = deriveFindingsHealth(input);
      expect(h.badges[0].label).toBe("– shown");
      expect(h.readIsCurrent).toBe(false);
      expect(h.level).toBe("amber");
    }
  });

  it("separates 'never read' from 'stopped updating'", () => {
    const never = deriveFindingsHealth({
      ...base,
      loaded: false,
      failed: true,
    });
    const stale = deriveFindingsHealth({ ...base, failed: true });
    expect(never.headline).toMatch(/could not read/i);
    expect(stale.headline).toMatch(/stopped updating/i);
    expect(never.headline).not.toEqual(stale.headline);
  });

  it("names the window the filter actually selected", () => {
    expect(deriveFindingsHealth({ ...base, triaged: false }).headline).toMatch(
      /untriaged findings/
    );
    expect(deriveFindingsHealth({ ...base, triaged: true }).headline).toMatch(
      /triaged findings/
    );
  });

  it("puts the proxy's own sentence in the detail when coord did not answer", () => {
    const h = deriveFindingsHealth({
      ...base,
      unavailable: "coord has no findings reader yet",
    });
    expect(h.detail).toBe("coord has no findings reader yet");
  });
});
