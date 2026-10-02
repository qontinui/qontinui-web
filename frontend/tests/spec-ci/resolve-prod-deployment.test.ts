import { describe, expect, it } from "vitest";
import {
  ApiError,
  classify,
  escapeCommandData,
  resolveDeployment,
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
