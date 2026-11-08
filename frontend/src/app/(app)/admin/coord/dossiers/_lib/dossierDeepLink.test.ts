import { describe, expect, it } from "vitest";
import {
  DOSSIERS_NO_PLAN_HREF,
  dossierHref,
  parseDossiersDeepLink,
} from "./dossierDeepLink";

describe("dossierDeepLink", () => {
  it("an empty search leaves every default alone", () => {
    expect(parseDossiersDeepLink("")).toEqual({
      slug: null,
      readiness: null,
      remediation: null,
      sort: null,
      order: null,
    });
  });

  it("reads an exact slug, trimmed", () => {
    expect(parseDossiersDeepLink("?slug=%20a-b%20").slug).toBe("a-b");
    expect(parseDossiersDeepLink("?slug=").slug).toBeNull();
  });

  it("the no-plan preset is the page's No plan yet button", () => {
    expect(parseDossiersDeepLink(DOSSIERS_NO_PLAN_HREF.split("?")[1]!)).toEqual(
      {
        slug: null,
        readiness: ["ready_for_pvi"],
        remediation: ["none"],
        sort: "recurrence_count",
        order: "desc",
      }
    );
  });

  it("explicit keys win over the preset's", () => {
    const link = parseDossiersDeepLink(
      "?preset=no-plan&sort=last_seen&order=asc&readiness=none"
    );
    expect(link.readiness).toEqual(["none"]);
    expect(link.remediation).toEqual(["none"]);
    expect(link.sort).toBe("last_seen");
    expect(link.order).toBe("asc");
  });

  it("repeated keys repeat, deduped; unknown remediation/sort/order are dropped", () => {
    const link = parseDossiersDeepLink(
      "?readiness=a&readiness=a&readiness=b&remediation_state=draft&remediation_state=bogus&sort=nope&order=sideways"
    );
    expect(link.readiness).toEqual(["a", "b"]);
    expect(link.remediation).toEqual(["draft"]);
    expect(link.sort).toBeNull();
    expect(link.order).toBeNull();
  });

  it("dossierHref encodes the slug and round-trips", () => {
    const href = dossierHref("a b/c");
    expect(href).toBe("/admin/coord/dossiers?slug=a%20b%2Fc");
    expect(parseDossiersDeepLink(href.split("?")[1]!).slug).toBe("a b/c");
  });
});
