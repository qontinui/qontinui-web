/**
 * The adopt-all run, in isolation from any rendering.
 *
 * What is pinned, and why each would fail silently:
 *
 * 1. **It is offered only on coord's answer that this is NOT the system
 *    tenant** — the production error envelope included, and every other answer
 *    (none yet, a 404 proxy gap, a 500, a 403 for another reason) read as
 *    "not offered".
 * 2. **Selection reads coord's `update_available` and nothing else**, for
 *    every kind.
 * 3. **Every call is pinned to the PREVIEW's versions**, asserted as literals.
 * 4. **The run is SEQUENTIAL** — the second request is not sent until the
 *    first has answered.
 * 5. **"Refused" needs coord's 4xx.** No status, a 5xx, an unreadable answer
 *    and a rejection are "unconfirmed": coord commits before it answers, so
 *    none of them says nothing landed.
 * 6. **A refusal is one row's outcome**, and the run continues past it.
 * 7. **The run aborts before any request once the tenant changes or Stop is
 *    pressed**, and the skipped rows say which.
 * 8. **The re-read reconciles what the run could not confirm.**
 */

import { describe, it, expect, vi } from "vitest";
import {
  adoptAllCandidates,
  adoptEffectCounts,
  adoptEffectOf,
  adoptSequentially,
  coordAnswered,
  coordSaidNotSystemTenant,
  publishSurfaceRetired,
  isNotSystemTenantAnswer,
  pinnedPublicationVersion,
  reconcileRow,
  rowOutcomeOf,
  summarizeAdoptRun,
  type AdoptAllCandidate,
  type AdoptOne,
} from "./adoptAll";
import type { PromptDocumentKind, PromptDocumentSummary } from "../types";

function summary(
  kind: PromptDocumentKind,
  name: string,
  extra: Partial<PromptDocumentSummary> = {}
): PromptDocumentSummary {
  return {
    id: `doc-${kind}-${name}`,
    kind,
    name,
    description: null,
    format: "markdown",
    default_source: null,
    current_version: 3,
    updated_by: "someone@example.com",
    updated_at: "2026-11-07T10:00:00Z",
    ...extra,
  };
}

function candidate(
  name: string,
  extra: Partial<AdoptAllCandidate> = {}
): AdoptAllCandidate {
  return {
    kind: "policy",
    name,
    description: null,
    current_version: 3,
    latest_publication_version: 1,
    upstream_publication_version: null,
    local_modified: true,
    update_available: true,
    ...extra,
  };
}

const adopted = (to: number) =>
  ({
    ok: true,
    value: {
      kind: "policy",
      name: "x",
      from_version: to - 1,
      to_version: to,
      publication_version: 1,
      local_modified: true,
    },
  }) as const;

const STATUS_URL =
  "/api/v1/operations/coord/prompt-documents/auto-publish/status";
/** Coord's not_system_tenant body, as coord serves it. */
const COORD_BODY =
  '{"error":"not_system_tenant","detail":"publishing to the fleet is available only from the system tenant (coord.tenants.is_system)"}';
/**
 * The same answer as the BROWSER receives it: the web backend raises it as a
 * string `detail`, and its error handler puts that string under `message`
 * beside a generic `error`.
 */
const PROXIED_BODY = JSON.stringify({
  error: "FORBIDDEN",
  message: COORD_BODY,
  timestamp: 1794048000.1,
  path: `https://api.qontinui.io${STATUS_URL}`,
});

/**
 * A coord body as the BROWSER receives it from the web backend: coord's JSON,
 * relayed as a string under `message`, beside the backend's generic code.
 */
function relayed(status: number, coordBody: Record<string, unknown>): string {
  const generic: Record<number, string> = {
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
  };
  return `POST ${ADOPT_URL} failed: ${status} - ${JSON.stringify({
    error: generic[status] ?? "ERROR",
    message: JSON.stringify(coordBody),
    timestamp: 1794048000.1,
    path: `https://api.qontinui.io${ADOPT_URL}`,
  })}`;
}
const ADOPT_URL =
  "/api/v1/operations/coord/prompt-documents/policy/testing/upstream-adopt";
/** Coord's real document_moved body (`upstream_decisions.rs` `conflict()`). */
const movedBody = (expected: number, actual: number) => ({
  error: "document_moved",
  detail: `the decision was made against version ${expected} but the document is now at version ${actual}`,
  current_version: actual,
});

describe("isNotSystemTenantAnswer", () => {
  it("is true on coord's 403 not_system_tenant, relayed or direct", () => {
    expect(
      isNotSystemTenantAnswer(
        new Error(`GET ${STATUS_URL} failed: 403 - ${PROXIED_BODY}`)
      )
    ).toBe(true);
    expect(
      isNotSystemTenantAnswer(
        new Error(`GET ${STATUS_URL} failed: 403 - ${COORD_BODY}`)
      )
    ).toBe(true);
  });

  it("is false on any other status, code or shape", () => {
    expect(
      isNotSystemTenantAnswer(
        new Error(`GET ${STATUS_URL} failed: 500 - ${COORD_BODY}`)
      )
    ).toBe(false);
    expect(
      isNotSystemTenantAnswer(
        new Error(
          `GET ${STATUS_URL} failed: 403 - {"error":"FORBIDDEN","message":"not a tenant admin; not_system_tenant appears only in prose"}`
        )
      )
    ).toBe(false);
    expect(
      isNotSystemTenantAnswer(
        new TypeError("Failed to fetch not_system_tenant")
      )
    ).toBe(false);
  });
});

describe("publishSurfaceRetired", () => {
  const stamped = (tenant: string | null) => ({ tenant });

  it("hides nothing while no refusal is held", () => {
    expect(publishSurfaceRetired(null, "t-p", "t-p")).toBe(false);
    expect(publishSurfaceRetired(null, undefined, undefined)).toBe(false);
  });

  it("keeps any refusal standing while the page's project is UNKNOWN", () => {
    expect(publishSurfaceRetired(stamped("t-x"), undefined, undefined)).toBe(
      true
    );
    expect(publishSurfaceRetired(stamped("t-x"), undefined, "t-x")).toBe(true);
  });

  it("keeps a refusal standing until the page's own status read has answered", () => {
    expect(publishSurfaceRetired(stamped("t-x"), "t-p", "t-x")).toBe(true);
    expect(publishSurfaceRetired(stamped("t-x"), "t-p", undefined)).toBe(true);
  });

  it("then lets a refusal stamped with ANOTHER project go", () => {
    expect(publishSurfaceRetired(stamped("t-x"), "t-p", "t-p")).toBe(false);
  });

  it("keeps a refusal stamped with no project, or with the page's own, standing", () => {
    expect(publishSurfaceRetired(stamped(null), "t-p", "t-p")).toBe(true);
    expect(publishSurfaceRetired(stamped("t-p"), "t-p", "t-p")).toBe(true);
  });
});

describe("coordSaidNotSystemTenant", () => {
  const answer = (tenant: string | null) => ({
    refusal: "not_system_tenant",
    detail: `GET ${STATUS_URL} failed: 403 - ${PROXIED_BODY}`,
    tenant,
  });

  it("is true on coord's answer, for the project the answer was read in", () => {
    expect(coordSaidNotSystemTenant(answer("t-b"), "t-b")).toBe(true);
    expect(coordSaidNotSystemTenant(answer(null), null)).toBe(true);
  });

  it("is false for an answer another project earned, or one with no stamp", () => {
    // Another tab retargeted the request: B's answer is not the system
    // tenant's.
    expect(coordSaidNotSystemTenant(answer("t-other"), "t-system")).toBe(false);
    expect(coordSaidNotSystemTenant(answer(null), "t-system")).toBe(false);
    // An unstamped latch is no answer at all.
    expect(
      coordSaidNotSystemTenant(
        {
          refusal: "not_system_tenant",
          detail: `GET ${STATUS_URL} failed: 403 - ${PROXIED_BODY}`,
        },
        "t-b"
      )
    ).toBe(false);
  });

  it("is false for every other state: no answer, other refusals, other statuses", () => {
    // No answer yet — and the system tenant, whose read succeeds, looks the same.
    expect(coordSaidNotSystemTenant(null, "t-b")).toBe(false);
    // A proxy that does not carry the route says nothing about tenancy.
    expect(
      coordSaidNotSystemTenant(
        {
          refusal: "not_proxied",
          detail: `GET ${STATUS_URL} failed: 404 - {"detail":"Not Found"}`,
          tenant: "t-b",
        },
        "t-b"
      )
    ).toBe(false);
    // The sniffing classifier latched it, but the status is not coord's 403.
    expect(
      coordSaidNotSystemTenant(
        {
          refusal: "not_system_tenant",
          detail: `GET ${STATUS_URL} failed: 500 - ${COORD_BODY}`,
          tenant: "t-b",
        },
        "t-b"
      )
    ).toBe(false);
    // A 403 that is not this code.
    expect(
      coordSaidNotSystemTenant(
        {
          refusal: "not_system_tenant",
          detail: `GET ${STATUS_URL} failed: 403 - {"error":"FORBIDDEN","message":"not a tenant admin; not_system_tenant appears only in prose"}`,
          tenant: "t-b",
        },
        "t-b"
      )
    ).toBe(false);
    // Not an httpClient rejection at all.
    expect(
      coordSaidNotSystemTenant(
        {
          refusal: "not_system_tenant",
          detail: "TypeError: Failed to fetch not_system_tenant",
          tenant: "t-b",
        },
        "t-b"
      )
    ).toBe(false);
  });
});

describe("adoptAllCandidates", () => {
  it("offers nothing when no document is flagged", () => {
    expect(adoptAllCandidates([])).toEqual([]);
    expect(
      adoptAllCandidates([
        summary("policy", "a", { update_available: false }),
        summary("policy", "b"), // absent: UNKNOWN, not offered
      ])
    ).toEqual([]);
  });

  it("offers exactly the documents coord flagged, of every kind, in list order", () => {
    const docs = [
      summary("policy", "testing", {
        update_available: true,
        current_version: 6,
        latest_publication_version: 1,
      }),
      summary("policy", "coordination", { update_available: false }),
      summary("agent_playbook", "merge-shepherd", {
        update_available: true,
        current_version: 2,
        latest_publication_version: 4,
        upstream_publication_version: 3,
        local_modified: false,
      }),
      summary("prompt_template", "review", { update_available: true }),
    ];
    expect(adoptAllCandidates(docs).map((c) => `${c.kind}/${c.name}`)).toEqual([
      "policy/testing",
      "agent_playbook/merge-shepherd",
      "prompt_template/review",
    ]);
    expect(adoptAllCandidates(docs)[1]).toMatchObject({
      current_version: 2,
      latest_publication_version: 4,
      upstream_publication_version: 3,
      local_modified: false,
    });
  });
});

describe("pinnedPublicationVersion", () => {
  it("pins a served version and refuses to guess one", () => {
    expect(pinnedPublicationVersion(candidate("a"))).toBe(1);
    expect(
      pinnedPublicationVersion(
        candidate("a", { latest_publication_version: 7 })
      )
    ).toBe(7);
    expect(
      pinnedPublicationVersion(
        candidate("a", { latest_publication_version: null })
      )
    ).toBeNull();
    expect(
      pinnedPublicationVersion(
        candidate("a", { latest_publication_version: 0 })
      )
    ).toBeNull();
  });
});

describe("adoptEffectOf and adoptEffectCounts", () => {
  it("groups by coord's fields into four answers", () => {
    expect(
      adoptEffectOf(
        candidate("a", {
          upstream_publication_version: null,
          local_modified: true,
        })
      )
    ).toBe("never_adopted");
    expect(
      adoptEffectOf(
        candidate("a", {
          upstream_publication_version: 2,
          local_modified: true,
        })
      )
    ).toBe("overwrites_local_edits");
    expect(
      adoptEffectOf(
        candidate("a", {
          upstream_publication_version: 2,
          local_modified: false,
        })
      )
    ).toBe("clean");
    expect(
      adoptEffectOf(
        candidate("a", {
          upstream_publication_version: 2,
          local_modified: undefined,
        })
      )
    ).toBe("unknown");
  });

  it("counts every group over the rows that can be adopted, and only those", () => {
    expect(
      adoptEffectCounts([
        candidate("o1", { upstream_publication_version: 2 }),
        candidate("o2", { upstream_publication_version: 2 }),
        candidate("u1", {
          upstream_publication_version: 2,
          local_modified: undefined,
        }),
        candidate("n1"),
        candidate("clean", {
          upstream_publication_version: 2,
          local_modified: false,
        }),
        // Would overwrite, but cannot be adopted here: not counted.
        candidate("unpinned", {
          upstream_publication_version: 2,
          latest_publication_version: null,
        }),
      ])
    ).toEqual({ overwrites: 2, unknown: 1, neverAdopted: 1 });
    expect(adoptEffectCounts([])).toEqual({
      overwrites: 0,
      unknown: 0,
      neverAdopted: 0,
    });
  });
});

describe("coordAnswered", () => {
  it("is true when the body carries coord's answer, relayed or by its own code", () => {
    expect(coordAnswered(relayed(409, movedBody(6, 7)))).toBe(true);
    // Coord's legacy bodies carry prose under `error`; relayed, it still counts.
    expect(
      coordAnswered(
        relayed(404, { error: "no such prompt document in this tenant" })
      )
    ).toBe(true);
    expect(
      coordAnswered(
        `POST ${ADOPT_URL} failed: 409 - ${JSON.stringify(movedBody(6, 7))}`
      )
    ).toBe(true);
  });

  it("is false for a refusal not in coord's words", () => {
    for (const [status, body] of [
      [401, { error: "UNAUTHORIZED", message: "Not authenticated" }],
      [403, { error: "FORBIDDEN", message: "tenant admin required" }],
      [422, { error: "VALIDATION_ERROR", message: "field required" }],
      // A route this deployment does not proxy, in the envelope the
      // backend's `http_exception_handler` builds.
      [
        404,
        {
          error: "NOT_FOUND",
          message: "Not Found",
          timestamp: 1794048000.1,
          path: `https://api.qontinui.io${ADOPT_URL}`,
        },
      ],
    ] as const) {
      expect(
        coordAnswered(
          `POST ${ADOPT_URL} failed: ${status} - ${JSON.stringify(body)}`
        )
      ).toBe(false);
    }
    expect(coordAnswered("TypeError: Failed to fetch")).toBe(false);
  });
});

describe("rowOutcomeOf", () => {
  const moved = relayed(409, movedBody(6, 7));

  it("is adopted only when coord names the version it landed as", () => {
    expect(rowOutcomeOf(adopted(9))).toEqual({
      state: "adopted",
      toVersion: 9,
    });
    expect(
      rowOutcomeOf({ ok: true, value: { queued: true } as never })
    ).toEqual({
      state: "unconfirmed",
      cause: "unrecognized_answer",
      detail: '{"queued":true}',
    });
  });

  it("is refused only on a 4xx, verbatim, naming who refused", () => {
    expect(
      rowOutcomeOf({
        ok: false,
        refusal: "document_moved",
        detail: moved,
        status: 409,
      })
    ).toEqual({
      state: "refused",
      by: "coord",
      refusal: "document_moved",
      detail: moved,
      status: 409,
    });
    const expired = `POST ${ADOPT_URL} failed: 401 - {"error":"UNAUTHORIZED","message":"Not authenticated"}`;
    expect(
      rowOutcomeOf({
        ok: false,
        refusal: "unknown",
        detail: expired,
        status: 401,
      })
    ).toEqual({
      state: "refused",
      by: "unattributed",
      refusal: "unknown",
      detail: expired,
      status: 401,
    });
  });

  it("is unconfirmed, not refused, when an answer arrived but could not be read", () => {
    expect(
      rowOutcomeOf({
        ok: false,
        refusal: "unknown",
        detail: "Unexpected token < in JSON at position 0",
        status: 200,
      })
    ).toEqual({
      state: "unconfirmed",
      cause: "unreadable_answer",
      detail: "Unexpected token < in JSON at position 0",
    });
  });

  it("is unconfirmed when nothing says the adopt did not land", () => {
    const gateway =
      'POST /api/v1/operations/coord/prompt-documents/policy/testing/upstream-adopt failed: 504 - {"error":"GATEWAY_TIMEOUT"}';
    expect(
      rowOutcomeOf({
        ok: false,
        refusal: "unknown",
        detail: gateway,
        status: 504,
      })
    ).toEqual({ state: "unconfirmed", cause: "server_error", detail: gateway });
    expect(
      rowOutcomeOf({
        ok: false,
        refusal: "unknown",
        detail: "TypeError: Failed to fetch",
        status: null,
      })
    ).toEqual({
      state: "unconfirmed",
      cause: "no_answer",
      detail: "TypeError: Failed to fetch",
    });
  });
});

describe("adoptSequentially", () => {
  it("sends each adopt pinned to the preview's versions", async () => {
    const adoptOne = vi.fn<AdoptOne>().mockResolvedValue(adopted(7));
    await adoptSequentially(
      [
        candidate("testing", {
          current_version: 6,
          latest_publication_version: 1,
        }),
        candidate("coordination", {
          current_version: 32,
          latest_publication_version: 3,
        }),
      ],
      adoptOne
    );
    expect(adoptOne.mock.calls).toEqual([
      ["policy", "testing", 1, 6],
      ["policy", "coordination", 3, 32],
    ]);
  });

  it("does not send the next adopt until the previous one has answered", async () => {
    const resolvers: Array<(v: ReturnType<typeof adopted>) => void> = [];
    const adoptOne = vi.fn<AdoptOne>(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const run = adoptSequentially(
      [candidate("a"), candidate("b"), candidate("c")],
      adoptOne
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(adoptOne).toHaveBeenCalledTimes(1);

    resolvers[0]?.(adopted(4));
    await vi.waitFor(() => expect(adoptOne).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(adoptOne).toHaveBeenCalledTimes(2);

    resolvers[1]?.(adopted(4));
    await vi.waitFor(() => expect(adoptOne).toHaveBeenCalledTimes(3));
    resolvers[2]?.(adopted(4));
    const outcomes = await run;
    expect([...outcomes.values()].map((o) => o.state)).toEqual([
      "adopted",
      "adopted",
      "adopted",
    ]);
  });

  it("carries on past a refusal, a 5xx and a rejection, classifying each", async () => {
    const moved = relayed(409, movedBody(3, 4));
    const adoptOne = vi
      .fn<AdoptOne>()
      .mockResolvedValueOnce(adopted(4))
      .mockResolvedValueOnce({
        ok: false,
        refusal: "document_moved",
        detail: moved,
        status: 409,
      })
      .mockResolvedValueOnce({
        ok: false,
        refusal: "unknown",
        detail: "POST /x failed: 502 - bad gateway",
        status: 502,
      })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(adopted(11));
    const onSettled = vi.fn();
    const outcomes = await adoptSequentially(
      ["a", "b", "c", "d", "e"].map((n) => candidate(n)),
      adoptOne,
      { onSettled }
    );

    expect(adoptOne).toHaveBeenCalledTimes(5);
    expect(outcomes.get("policy/b")).toEqual({
      state: "refused",
      by: "coord",
      refusal: "document_moved",
      detail: moved,
      status: 409,
    });
    expect(outcomes.get("policy/c")).toEqual({
      state: "unconfirmed",
      cause: "server_error",
      detail: "POST /x failed: 502 - bad gateway",
    });
    expect(outcomes.get("policy/d")).toEqual({
      state: "unconfirmed",
      cause: "no_answer",
      detail: "network down",
    });
    expect(outcomes.get("policy/e")).toEqual({
      state: "adopted",
      toVersion: 11,
    });
    expect(onSettled).toHaveBeenCalledTimes(5);
    expect(summarizeAdoptRun(outcomes.values())).toEqual({
      adopted: 2,
      refused: 1,
      unconfirmed: 2,
      notAttempted: 0,
    });
  });

  it("stops between rows, and the skipped rows say why", async () => {
    let stop = false;
    const adoptOne = vi.fn<AdoptOne>(async () => {
      stop = true; // the operator presses Stop while the first is in flight
      return adopted(4);
    });
    const outcomes = await adoptSequentially(
      [candidate("a"), candidate("b"), candidate("c")],
      adoptOne,
      { abortReason: () => (stop ? "stopped" : null) }
    );
    expect(adoptOne).toHaveBeenCalledTimes(1);
    expect([...outcomes.entries()]).toEqual([
      ["policy/a", { state: "adopted", toVersion: 4 }],
      ["policy/b", { state: "not_attempted", reason: "stopped" }],
      ["policy/c", { state: "not_attempted", reason: "stopped" }],
    ]);
  });

  it("sends nothing at all when the tenant already changed before the first request", async () => {
    const adoptOne = vi.fn<AdoptOne>().mockResolvedValue(adopted(4));
    const outcomes = await adoptSequentially(
      [candidate("a"), candidate("b")],
      adoptOne,
      { abortReason: () => "tenant_changed" }
    );
    expect(adoptOne).not.toHaveBeenCalled();
    expect([...outcomes.values()]).toEqual([
      { state: "not_attempted", reason: "tenant_changed" },
      { state: "not_attempted", reason: "tenant_changed" },
    ]);
  });

  it("checks the guard before EVERY request, not once", async () => {
    let tenant = "t1";
    const adoptOne = vi.fn<AdoptOne>(async () => {
      tenant = "t2"; // another tab switches the project mid-run
      return adopted(4);
    });
    const outcomes = await adoptSequentially(
      [candidate("a"), candidate("b")],
      adoptOne,
      { abortReason: () => (tenant !== "t1" ? "tenant_changed" : null) }
    );
    expect(adoptOne).toHaveBeenCalledTimes(1);
    expect(outcomes.get("policy/b")).toEqual({
      state: "not_attempted",
      reason: "tenant_changed",
    });
  });

  it("never sends a row with no publication version to pin", async () => {
    const adoptOne = vi.fn<AdoptOne>().mockResolvedValue(adopted(4));
    const outcomes = await adoptSequentially(
      [candidate("a", { latest_publication_version: null }), candidate("b")],
      adoptOne
    );
    expect(adoptOne.mock.calls).toEqual([["policy", "b", 1, 3]]);
    expect(outcomes.get("policy/a")).toEqual({
      state: "not_attempted",
      reason: "no_publication_version",
    });
  });

  it("does nothing for an empty selection", async () => {
    const adoptOne = vi.fn<AdoptOne>();
    const outcomes = await adoptSequentially([], adoptOne);
    expect(adoptOne).not.toHaveBeenCalled();
    expect(outcomes.size).toBe(0);
  });
});

describe("reconcileRow", () => {
  const before = candidate("testing", {
    current_version: 6,
    latest_publication_version: 1,
    upstream_publication_version: null,
  });

  it("reports the adopt in place when the re-read tracks the pinned publication at a new version", () => {
    expect(
      reconcileRow(before, [
        summary("policy", "testing", {
          current_version: 7,
          upstream_publication_version: 1,
        }),
      ])
    ).toEqual({ state: "tracks_publication", currentVersion: 7, tracked: 1 });
  });

  it("reports nothing landed when the re-read matches the preview", () => {
    expect(
      reconcileRow(before, [
        summary("policy", "testing", {
          current_version: 6,
          upstream_publication_version: null,
        }),
      ])
    ).toEqual({ state: "unchanged", currentVersion: 6, tracked: null });
  });

  it("reports a change that is not the pinned publication", () => {
    expect(
      reconcileRow(before, [
        summary("policy", "testing", {
          current_version: 8,
          upstream_publication_version: null,
        }),
      ])
    ).toEqual({ state: "changed", currentVersion: 8, tracked: null });
  });

  it("is unknown when the re-read failed or does not list the document", () => {
    expect(reconcileRow(before, null)).toEqual({
      state: "unknown",
      why: "read_failed",
    });
    expect(reconcileRow(before, [summary("policy", "other")])).toEqual({
      state: "unknown",
      why: "absent",
    });
  });
});
