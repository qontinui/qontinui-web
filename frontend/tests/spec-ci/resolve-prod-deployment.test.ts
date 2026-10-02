import { describe, expect, it } from "vitest";
import {
  aliasDecision,
  ApiError,
  classify,
  escapeCommandData,
  parseFailedDeploymentUids,
  resolveDeployment,
  selectRollbackTarget,
  type ResolveDeps,
  type VercelDeployment,
} from "./resolve-prod-deployment";

/**
 * classify() decides whether a production deploy is smoked, skipped by name,
 * or turns the run red. One test per row of the plan's D3 table
 * (2026-10-02-frontend-post-deploy-smoke-misses-most-production-deploys).
 */

const SHA = "a".repeat(40);
const NEWER = "b".repeat(40);
const OTHER = "c".repeat(40);

function dep(
  sha: string,
  state: string,
  uid = `dpl_${sha.slice(0, 6)}${state}`,
  created = 1
): VercelDeployment {
  return {
    uid,
    url: `qontinui-web-${uid.replace(/_/g, "-").toLowerCase()}.vercel.app`,
    state,
    created,
    meta: { githubCommitSha: sha },
  };
}

const base = { sha: SHA, mainHeadSha: SHA, budgetElapsed: false };

describe("classify", () => {
  it("smokes a READY production deployment of the sha", () => {
    const outcome = classify({
      ...base,
      deployments: [dep(SHA, "READY", "dpl_abc")],
    });
    expect(outcome).toEqual({
      kind: "smoke",
      deploymentId: "dpl_abc",
      environmentUrl: "https://qontinui-web-dpl-abc.vercel.app",
      sha: SHA,
    });
  });

  it("reads the legacy readyState field when state is absent", () => {
    const d = dep(SHA, "READY", "dpl_x");
    delete d.state;
    d.readyState = "READY";
    expect(classify({ ...base, deployments: [d] }).kind).toBe("smoke");
  });

  it("takes the newest READY deployment when a sha was redeployed", () => {
    const outcome = classify({
      ...base,
      deployments: [
        dep(SHA, "READY", "dpl_old", 1),
        dep(SHA, "READY", "dpl_new", 2),
      ],
    });
    expect(outcome).toMatchObject({ kind: "smoke", deploymentId: "dpl_new" });
  });

  it("never takes a READY deployment of a different sha", () => {
    const outcome = classify({
      ...base,
      deployments: [dep(OTHER, "READY"), dep(NEWER, "READY")],
    });
    expect(outcome.kind).toBe("wait");
  });

  it("skips by name when there is no deployment and main moved to a deployed head", () => {
    const outcome = classify({
      ...base,
      mainHeadSha: NEWER,
      deployments: [dep(NEWER, "BUILDING")],
    });
    expect(outcome).toMatchObject({
      kind: "skip_superseded",
      supersededBy: NEWER,
    });
    expect(outcome.kind === "skip_superseded" && outcome.reason).toContain(
      "no production deployment"
    );
  });

  it("skips by name when the sha's deployment was CANCELED and main moved", () => {
    const outcome = classify({
      ...base,
      mainHeadSha: NEWER,
      deployments: [dep(SHA, "CANCELED"), dep(NEWER, "READY")],
    });
    expect(outcome).toMatchObject({
      kind: "skip_superseded",
      supersededBy: NEWER,
    });
    expect(outcome.kind === "skip_superseded" && outcome.reason).toContain(
      "CANCELED"
    );
  });

  it("waits when main moved but the newer head has no deployment yet", () => {
    const outcome = classify({ ...base, mainHeadSha: NEWER, deployments: [] });
    expect(outcome.kind).toBe("wait");
  });

  it("fails red on an ERROR deployment of the sha", () => {
    const outcome = classify({ ...base, deployments: [dep(SHA, "ERROR")] });
    expect(outcome.kind).toBe("fail");
    expect(outcome.kind === "fail" && outcome.reason).toContain("ERROR");
  });

  it("fails red on ERROR even when main has moved", () => {
    const outcome = classify({
      ...base,
      mainHeadSha: NEWER,
      deployments: [dep(SHA, "ERROR"), dep(NEWER, "READY")],
    });
    expect(outcome.kind).toBe("fail");
  });

  it.each(["BUILDING", "QUEUED", "INITIALIZING"])(
    "waits while the sha's deployment is %s",
    (state) => {
      const outcome = classify({ ...base, deployments: [dep(SHA, state)] });
      expect(outcome.kind).toBe("wait");
    }
  );

  it("waits on a rebuild after an ERROR rather than failing", () => {
    const outcome = classify({
      ...base,
      deployments: [
        dep(SHA, "ERROR", "dpl_e", 1),
        dep(SHA, "BUILDING", "dpl_b", 2),
      ],
    });
    expect(outcome.kind).toBe("wait");
  });

  it("waits when no deployment exists yet and main has not moved", () => {
    expect(classify({ ...base, deployments: [] }).kind).toBe("wait");
  });

  it("fails red when the budget elapses while still waiting", () => {
    const outcome = classify({
      ...base,
      budgetElapsed: true,
      deployments: [dep(SHA, "BUILDING")],
    });
    expect(outcome.kind).toBe("fail");
    expect(outcome.kind === "fail" && outcome.reason).toMatch(/timed out/);
  });

  it("waits on a READY deployment that is STAGED, not yet promoted", () => {
    const d = { ...dep(SHA, "READY"), readySubstate: "STAGED" };
    expect(classify({ ...base, deployments: [d] }).kind).toBe("wait");
  });

  it("smokes a READY deployment once it is PROMOTED", () => {
    const d = { ...dep(SHA, "READY"), readySubstate: "PROMOTED" };
    expect(classify({ ...base, deployments: [d] }).kind).toBe("smoke");
  });

  it("skips by name a STAGED deployment once main moved to a deployed head", () => {
    const d = { ...dep(SHA, "READY"), readySubstate: "STAGED" };
    const outcome = classify({
      ...base,
      mainHeadSha: NEWER,
      deployments: [d, dep(NEWER, "READY")],
    });
    expect(outcome.kind).toBe("skip_superseded");
  });

  it("fails red at once on a CANCELED head when main has not moved", () => {
    const outcome = classify({ ...base, deployments: [dep(SHA, "CANCELED")] });
    expect(outcome.kind).toBe("fail");
    expect(outcome.kind === "fail" && outcome.reason).toContain("CANCELED");
  });

  it("names paused auto-assignment when a STAGED deployment times out", () => {
    const d = { ...dep(SHA, "READY"), readySubstate: "STAGED" };
    const outcome = classify({
      ...base,
      budgetElapsed: true,
      deployments: [d],
    });
    expect(outcome.kind).toBe("fail");
    expect(outcome.kind === "fail" && outcome.reason).toContain(
      "auto-assignment may be paused after a rollback"
    );
  });

  it("fails red on a READY deployment whose url is not a bare host", () => {
    const d = dep(SHA, "READY");
    d.url = "evil.example\n::set-output name=ok::true";
    expect(classify({ ...base, deployments: [d] }).kind).toBe("fail");
  });
});

function fakeDeps(
  listDeployments: ResolveDeps["listDeployments"],
  mainHead: ResolveDeps["mainHead"] = async () => SHA
) {
  let clock = 0;
  const deps: ResolveDeps = {
    listDeployments,
    mainHead,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };
  return deps;
}

const OPTS = {
  sha: SHA,
  budgetMs: 60_000,
  pollMs: 15_000,
  maxConsecutiveErrors: 3,
};

describe("resolveDeployment", () => {
  it("polls until the deployment is READY", async () => {
    let polls = 0;
    const outcome = await resolveDeployment(
      fakeDeps(async () =>
        ++polls < 3 ? [dep(SHA, "BUILDING")] : [dep(SHA, "READY", "dpl_r")]
      ),
      OPTS
    );
    expect(outcome).toMatchObject({ kind: "smoke", deploymentId: "dpl_r" });
    expect(polls).toBe(3);
  });

  it("fails red on timeout", async () => {
    const outcome = await resolveDeployment(
      fakeDeps(async () => [dep(SHA, "BUILDING")]),
      OPTS
    );
    expect(outcome.kind).toBe("fail");
    expect(outcome.kind === "fail" && outcome.reason).toMatch(/timed out/);
  });

  it("fails red at once on a non-transient API error (e.g. a 401)", async () => {
    let polls = 0;
    const outcome = await resolveDeployment(
      fakeDeps(async () => {
        polls += 1;
        throw new ApiError("api.vercel.com answered HTTP 401", false);
      }),
      OPTS
    );
    expect(outcome).toEqual({
      kind: "fail",
      reason: "API error: api.vercel.com answered HTTP 401",
    });
    expect(polls).toBe(1);
  });

  it("retries transient API errors, then fails red", async () => {
    let polls = 0;
    const outcome = await resolveDeployment(
      fakeDeps(async () => {
        polls += 1;
        throw new ApiError("HTTP 503", true);
      }),
      OPTS
    );
    expect(outcome.kind).toBe("fail");
    expect(polls).toBe(3);
  });

  it("recovers from a transient API error", async () => {
    let polls = 0;
    const outcome = await resolveDeployment(
      fakeDeps(async () => {
        if (++polls === 1) throw new ApiError("HTTP 502", true);
        return [dep(SHA, "READY")];
      }),
      OPTS
    );
    expect(outcome.kind).toBe("smoke");
  });

  it("fails red when the GitHub main-head read errors", async () => {
    const outcome = await resolveDeployment(
      fakeDeps(
        async () => [],
        async () => {
          throw new ApiError("api.github.com answered HTTP 403", false);
        }
      ),
      OPTS
    );
    expect(outcome.kind).toBe("fail");
  });

  it("lists this sha, and main's head only once main has moved", async () => {
    const asked: string[] = [];
    await resolveDeployment(
      fakeDeps(
        async (forSha) => {
          asked.push(forSha);
          return [dep(forSha, "READY")];
        },
        async () => NEWER
      ),
      OPTS
    );
    expect(asked).toEqual([SHA, NEWER]);
  });

  it("skips by name once main moves on mid-wait", async () => {
    let polls = 0;
    const outcome = await resolveDeployment(
      fakeDeps(
        async () => (polls >= 2 ? [dep(NEWER, "BUILDING")] : []),
        async () => (++polls >= 2 ? NEWER : SHA)
      ),
      OPTS
    );
    expect(outcome).toMatchObject({
      kind: "skip_superseded",
      supersededBy: NEWER,
    });
  });
});

describe("escapeCommandData", () => {
  it("cannot let a string start a new workflow command", () => {
    expect(escapeCommandData("a\r\n::error::x 100%")).toBe(
      "a%0D%0A::error::x 100%25"
    );
  });
});

describe("selectRollbackTarget", () => {
  const SELF = { uid: "dpl_self", created: 100 };

  it("takes the newest promoted READY deployment created before this one", () => {
    const target = selectRollbackTarget(
      [
        dep(OTHER, "READY", "dpl_older", 10),
        dep(NEWER, "READY", "dpl_prior", 50),
        { ...dep(SHA, "READY", "dpl_self", 100) },
      ],
      SELF
    );
    expect(target).toEqual({
      found: true,
      uid: "dpl_prior",
      url: "https://qontinui-web-dpl-prior.vercel.app",
    });
  });

  it.each(["ERROR", "BUILDING", "CANCELED", "QUEUED"])(
    "skips a %s deployment",
    (state) => {
      const target = selectRollbackTarget(
        [dep(OTHER, "READY", "dpl_good", 10), dep(NEWER, state, "dpl_bad", 50)],
        SELF
      );
      expect(target).toMatchObject({ found: true, uid: "dpl_good" });
    }
  );

  it("skips a READY deployment that was never promoted (STAGED)", () => {
    const target = selectRollbackTarget(
      [
        dep(OTHER, "READY", "dpl_good", 10),
        { ...dep(NEWER, "READY", "dpl_staged", 50), readySubstate: "STAGED" },
      ],
      SELF
    );
    expect(target).toMatchObject({ found: true, uid: "dpl_good" });
  });

  it("never picks a deployment newer than this one", () => {
    const target = selectRollbackTarget(
      [
        dep(OTHER, "READY", "dpl_good", 10),
        dep(NEWER, "READY", "dpl_newer", 200),
      ],
      SELF
    );
    expect(target).toMatchObject({ found: true, uid: "dpl_good" });
  });

  it("never picks this deployment itself", () => {
    const target = selectRollbackTarget(
      [dep(SHA, "READY", "dpl_self", 100), dep(SHA, "READY", "dpl_self", 1)],
      SELF
    );
    expect(target.found).toBe(false);
  });

  it("never picks a deployment whose smoke already failed", () => {
    const target = selectRollbackTarget(
      [
        dep(OTHER, "READY", "dpl_good", 10),
        dep(NEWER, "READY", "dpl_failed", 50),
      ],
      SELF,
      ["dpl_failed"]
    );
    expect(target).toMatchObject({ found: true, uid: "dpl_good" });
  });

  it("reports not-found when nothing qualifies", () => {
    const target = selectRollbackTarget(
      [dep(OTHER, "ERROR", "dpl_e", 10), dep(NEWER, "READY", "dpl_n", 300)],
      SELF
    );
    expect(target.found).toBe(false);
    expect(selectRollbackTarget([], SELF).found).toBe(false);
  });
});

describe("aliasDecision", () => {
  const SELF_UID = "dpl_self";

  it.each(["pre_smoke", "pre_rollback"] as const)(
    "%s: proceeds when the alias serves this deployment",
    (site) => {
      expect(aliasDecision(site, SELF_UID, SELF_UID).action).toBe("proceed");
    }
  );

  it("pre_smoke: skips (a notice, not a pass) when a newer deployment is live", () => {
    const d = aliasDecision("pre_smoke", "dpl_newer", SELF_UID);
    expect(d).toMatchObject({ action: "skip", level: "notice" });
    expect(d.message).toContain("dpl_newer");
    expect(d.message).toContain("NOT a pass");
  });

  it("pre_smoke: proceeds with a warning when the alias is unreadable", () => {
    expect(aliasDecision("pre_smoke", null, SELF_UID)).toMatchObject({
      action: "proceed",
      level: "warning",
    });
  });

  it("pre_rollback: blocks the promote when a different deployment is live", () => {
    const d = aliasDecision("pre_rollback", "dpl_newer", SELF_UID);
    expect(d).toMatchObject({ action: "block", level: "error" });
    expect(d.message).toContain("dpl_newer");
  });

  it("pre_rollback: blocks the promote when the alias is unreadable", () => {
    expect(aliasDecision("pre_rollback", null, SELF_UID)).toMatchObject({
      action: "block",
      level: "error",
    });
  });
});

describe("parseFailedDeploymentUids", () => {
  it("reads every marker the paging step writes, de-duplicated", () => {
    const uids = parseFailedDeploymentUids([
      "Smoke failed.\n<!-- verify-frontend-failed-deployment: dpl_A1 -->",
      "<!-- verify-frontend-failed-deployment: dpl_B2 -->\n<!-- verify-frontend-failed-deployment: dpl_A1 -->",
      null,
      "no marker here, dpl_C3",
    ]);
    expect(uids).toEqual(["dpl_A1", "dpl_B2"]);
  });
});
