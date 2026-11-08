/**
 * The pure half of the Connected Organizations card's un-enroll (plan
 * `2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped`
 * Phase 8, `./ConnectedOrgsUnenroll.tsx`): who removed a repo, in words; where
 * a read-back finds a repo; how a rejected un-enrollment is classified; and
 * what an UNKNOWN says.
 *
 * The rendered flows — the control, the consent dialog, the DELETE, the
 * read-back, the refusals — are driven through the card itself in
 * `ConnectedOrgs.test.tsx`. These are the derivations those flows render,
 * enumerated over their inputs, and `useUnenroll` driven directly for the one
 * refusal the card cannot reach: a blank tenant, which the dialog never
 * passes.
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  COVERAGE_UNENROLL_PRINCIPALS,
  coverageReturnHint,
  decisionActorWords,
  isCoveragePrincipal,
  repoSighting,
  unenrollFailureDetail,
  unenrollFailureOf,
  unenrollUnknownText,
  unenrolledDetail,
  UnenrollOutcomeLine,
  useUnenroll,
} from "./ConnectedOrgsUnenroll";

describe("ConnectedOrgsUnenroll derivations", () => {
  it("knows exactly the two coverage principals", () => {
    expect(COVERAGE_UNENROLL_PRINCIPALS).toEqual([
      "webhook:installation_repositories",
      "reconcile:installation_coverage",
    ]);
    expect(isCoveragePrincipal("webhook:installation_repositories")).toBe(true);
    expect(isCoveragePrincipal("reconcile:installation_coverage")).toBe(true);
    for (const other of [
      "Webhook:installation_repositories",
      " webhook:installation_repositories",
      "webhook:installation",
      "operator:5f0c",
      "",
      null,
      undefined,
    ]) {
      expect(isCoveragePrincipal(other)).toBe(false);
    }
  });

  it("names a decision's actor class, keeps an unknown label, and says when none was recorded", () => {
    expect(decisionActorWords("operator:5f0c2a1e")).toBe("an operator");
    expect(decisionActorWords("agent:01a1bc4a")).toBe("an agent");
    expect(decisionActorWords("device:6e00ba36")).toBe("a paired device");
    expect(decisionActorWords("service:web-backend")).toBe("a service");
    expect(decisionActorWords("ops@example.com")).toBe("ops@example.com");
    expect(decisionActorWords("test:fixture")).toBe("test:fixture");
    expect(decisionActorWords("constructor:x")).toBe("constructor:x");
    expect(decisionActorWords(":operator")).toBe(":operator");
    expect(decisionActorWords("  ")).toBe("someone coord did not record");
    expect(decisionActorWords(null)).toBe("someone coord did not record");
  });

  it("words a row's detail by its cause", () => {
    expect(
      unenrolledDetail(
        {
          unenrolled_by: "webhook:installation_repositories",
          unenroll_reason: "installation_repositories: removed",
        },
        "WHEN"
      )
    ).toBe("removed WHEN: GitHub App access was removed");
    expect(
      unenrolledDetail(
        { unenrolled_by: "operator:5f0c", unenroll_reason: "  " },
        "WHEN"
      )
    ).toBe("removed WHEN by an operator: no reason recorded");
    expect(coverageReturnHint("jspinak/bdo")).toContain("jspinak/bdo");
  });

  it("finds a repo ASCII-case-insensitively, and an enrolled spelling wins", () => {
    const row = (repo: string) => ({
      repo,
      merge_enabled: null,
      profile_source: null,
    });
    expect(repoSighting("Org/Repo", [], [row("org/repo")])).toBe("unenrolled");
    expect(repoSighting("org/repo", [row("ORG/REPO")], [row("org/repo")])).toBe(
      "enrolled"
    );
    expect(repoSighting("org/repo", [row("org/other")], [])).toBe("absent");
  });

  it("classifies a rejection: status, code, the 404's flag, and whether it may have landed", () => {
    const rejection = (status: number, body: unknown) =>
      new Error(
        `DELETE /api/v1/operations/pr-merge/onboarding/repos/a/b?reason=r failed: ${status} - ${JSON.stringify(body)}`
      );

    const forbidden = unenrollFailureOf(
      rejection(403, { error: "strategy_admin_required" })
    );
    expect(forbidden).toMatchObject({
      status: 403,
      code: "strategy_admin_required",
      tombstoned: null,
      mayHaveLanded: false,
    });

    const notFound = unenrollFailureOf(
      rejection(404, { error: "repo not found: a/b", tombstoned: true })
    );
    expect(notFound).toMatchObject({
      status: 404,
      code: null,
      tombstoned: true,
      mayHaveLanded: false,
    });
    // A tombstoned flag that is not a boolean is "not reported".
    expect(
      unenrollFailureOf(rejection(404, { tombstoned: "yes" })).tombstoned
    ).toBeNull();
    expect(
      unenrollFailureDetail(
        unenrollFailureOf(rejection(404, { error: "repo not found: a/b" })),
        "a/b"
      )
    ).toContain("Whether coord recorded an un-enrollment was not reported.");

    // A coord 5xx does not say whether the removal committed.
    expect(
      unenrollFailureOf(rejection(500, { error: "unenroll_repo failed" }))
        .mayHaveLanded
    ).toBe(true);
    // No answer at all (a network error) may have landed too.
    expect(unenrollFailureOf(new TypeError("Failed to fetch"))).toMatchObject({
      status: null,
      mayHaveLanded: true,
    });

    const envelope = (discriminator: string) => ({
      error: "GATEWAY_TIMEOUT",
      message: "timeout waiting for coord",
      refusal: {
        code: "upstream_timeout",
        discriminator,
        next_action: { kind: "retry_later", target: null },
        glossary_terms: ["coord"],
        detail: null,
        source: "web_backend",
        observed_at: "2026-11-08T17:00:00Z",
      },
    });
    for (const d of ["coord_write_timeout", "answer_lost", "answer_not_json"]) {
      expect(unenrollFailureOf(rejection(504, envelope(d))).mayHaveLanded).toBe(
        true
      );
    }
    // The web's 502: coord never saw the request.
    expect(
      unenrollFailureOf(rejection(502, envelope("coord_unreachable")))
        .mayHaveLanded
    ).toBe(false);
  });

  it("words every UNKNOWN by what the read-back last saw", () => {
    expect(unenrollUnknownText("a/b", "enrolled", 60)).toBe(
      "Whether coord stopped governing a/b is UNKNOWN: after 60 s of re-reading, coord still lists it as enrolled. Refresh the page and check before trying again."
    );
    expect(unenrollUnknownText("a/b", "absent", 60)).toContain(
      "does not list it as un-enrolled either"
    );
    expect(unenrollUnknownText("a/b", "unread", 60)).toContain(
      "could not be re-read"
    );
  });
});

describe("useUnenroll", () => {
  it("ends a blank-tenant confirm refused at once: nothing sent, no read-back, and only the operator's sentence", async () => {
    const poll = { start: vi.fn(), clear: vi.fn(), budgetSecs: 60 };
    const rereadOnce = vi.fn(async () => undefined);
    const enrolled = [
      { repo: "portofino/web", merge_enabled: false, profile_source: "auto" },
    ];
    const { result } = renderHook(() =>
      useUnenroll({
        enrolled,
        unenrolled: [],
        otherBusy: false,
        poll,
        rereadOnce,
        onStart: () => undefined,
      })
    );

    await act(async () => {
      await result.current.confirm("portofino/web", "archived", "   ");
    });

    const outcome = result.current.outcome;
    expect(outcome).toMatchObject({
      kind: "refused",
      repo: "portofino/web",
      failure: { status: null, unpinned: true, mayHaveLanded: false },
    });
    expect(result.current.unenrolling).toBeNull();
    expect(poll.start).not.toHaveBeenCalled();
    expect(rereadOnce).not.toHaveBeenCalled();

    render(<UnenrollOutcomeLine outcome={outcome!} data-testid="outcome" />);
    expect(screen.getByTestId("outcome").textContent).toBe(
      "Coord did not stop governing portofino/web: No project was selected, so nothing was sent."
    );
  });
});
