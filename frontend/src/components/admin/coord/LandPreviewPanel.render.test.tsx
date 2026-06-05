import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { LandPreviewPanel, type LandPreviewResponse } from "./LandPreviewPanel";

/**
 * Renders LandPreviewPanel against a fixture matching coord's EXACT final
 * serde shapes (PredictedLandEffect). This guards the field-name alignment:
 * if the renderer reverts to guessed aliases (deploy.services, {lower,upper},
 * workflow.name, affected_agents, a confidence-band cascade verdict, …) these
 * assertions go red because the real fields would silently render empty.
 */

const FIXTURE: LandPreviewResponse = {
  action: "land",
  repo: "qontinui/qontinui-web",
  pr_number: 425,
  branch: "feat/coord-lands-dashboard",
  predicted: {
    cascade: {
      dependent_refs_to_restack: ["agent/child-a", "agent/child-b"],
      cascade_depth: 2,
      will_complete_cleanly: false, // bool — must render as a badge, not a band
      expected_conflicts: [
        {
          child_ref: "agent/child-a",
          paths: ["src/foo.ts", "src/bar.ts"],
          hunk_overlaps: 3,
          auto_resolvable: false,
        },
      ],
    },
    git: {
      will_advance_to: "abc1234",
      no_force_required: false,
    },
    ci: {
      pending: false,
      expected_pass: true,
      changed_paths: ["frontend/src/x.tsx"],
      note: null,
      workflows: [
        {
          workflow_name: "rust-ci",
          trigger_uncertain: true,
          path_conditioned: true,
          sample_size: 0, // → "no history"
          expected_pass: { point: 0.5, low: 0.2, high: 0.9 }, // wide → uncertain
        },
        {
          workflow_name: "Spec CI",
          trigger_uncertain: false,
          path_conditioned: false,
          sample_size: 42,
          expected_pass: { point: 0.95, low: 0.92, high: 0.98 },
        },
      ],
    },
    deploy: {
      pending: false,
      expected_health_check_pass: true,
      services_will_deploy: [
        { surface: "vercel", target: "qontinui-web" },
        { surface: "ecs", target: "coord-prod" },
      ],
      note: null,
    },
    main_merge_overlap: true,
    inferred_prior: {
      adverse_freq: 0.25,
      samples: 8,
      applied: true,
      provenance: "land-history",
    },
  },
  risk: { risky: true, reasons: ["cascade may not complete cleanly"] },
};

describe("LandPreviewPanel — renders coord's final serde fields", () => {
  it("cascade.will_complete_cleanly (bool) renders as a badge, not a confidence band", () => {
    render(<LandPreviewPanel preview={FIXTURE} />);
    const badge = screen.getByTestId("land-cascade-clean-badge");
    expect(badge.textContent).toBe("no");
  });

  it("conflict renders child_ref + hunk_overlaps (NOT affected_agents)", () => {
    render(<LandPreviewPanel preview={FIXTURE} />);
    const chip = screen.getByTestId("land-conflict-chip");
    expect(chip.textContent).toContain("agent/child-a");
    expect(chip.textContent).toContain("3 hunk overlaps");
    expect(screen.getByTestId("land-conflict-child-ref").textContent).toContain(
      "agent/child-a"
    );
  });

  it("git.will_advance_to renders (NOT main_will_advance_to)", () => {
    render(<LandPreviewPanel preview={FIXTURE} />);
    const advance = screen.getByTestId("land-git-advance");
    expect(advance.textContent).toContain("abc1234");
    expect(advance.textContent).toContain("force-push required");
  });

  it("ci workflows render by workflow_name with subtle chips", () => {
    render(<LandPreviewPanel preview={FIXTURE} />);
    const rows = screen.getAllByTestId("land-ci-workflow-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("rust-ci");
    expect(rows[0].textContent).toContain("trigger uncertain");
    expect(rows[0].textContent).toContain("path-conditioned");
    expect(rows[0].textContent).toContain("no history"); // sample_size === 0
    expect(rows[1].textContent).toContain("Spec CI");
    expect(rows[1].textContent).toContain("n=42");
    // ci.expected_pass (bool) → overall badge
    expect(screen.getByTestId("land-ci-overall-badge").textContent).toBe(
      "expected pass"
    );
  });

  it("per-workflow expected_pass interval drives the confidence band (wide → uncertain)", () => {
    render(<LandPreviewPanel preview={FIXTURE} />);
    const bands = screen.getAllByTestId("land-confidence-band");
    // The wide rust-ci interval (0.2–0.9) should carry the "uncertain" cue.
    expect(bands.some((b) => b.textContent?.includes("uncertain"))).toBe(true);
  });

  it("deploy renders surface + target (NOT deploy.services[].service)", () => {
    render(<LandPreviewPanel preview={FIXTURE} />);
    const chips = screen.getAllByTestId("land-deploy-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain("vercel");
    expect(chips[0].textContent).toContain("qontinui-web");
    expect(chips[1].textContent).toContain("ecs");
    expect(chips[1].textContent).toContain("coord-prod");
    expect(screen.getByTestId("land-deploy-health-badge").textContent).toBe(
      "health check pass"
    );
  });
});

describe("LandPreviewPanel — honest non-coverage (pending → note, not empty)", () => {
  const PENDING: LandPreviewResponse = {
    repo: "qontinui/qontinui-coord",
    pr_number: 1,
    predicted: {
      cascade: {
        dependent_refs_to_restack: [],
        will_complete_cleanly: true,
        expected_conflicts: [],
      },
      ci: { pending: true, workflows: [], note: "no workflow history yet" },
      deploy: {
        pending: true,
        services_will_deploy: [],
        note: "deploy targets undeclared",
      },
    },
    risk: { risky: false, reasons: [] },
  };

  it("ci.pending renders the note as the explanation, not an empty list", () => {
    render(<LandPreviewPanel preview={PENDING} />);
    const el = screen.getByTestId("land-ci-pending");
    expect(el.textContent).toContain("prediction unavailable");
    expect(el.textContent).toContain("no workflow history yet");
  });

  it("deploy.pending renders the note as the explanation", () => {
    render(<LandPreviewPanel preview={PENDING} />);
    const el = screen.getByTestId("land-deploy-pending");
    expect(el.textContent).toContain("prediction unavailable");
    expect(el.textContent).toContain("deploy targets undeclared");
  });

  it("cascade.will_complete_cleanly === true → 'yes' badge", () => {
    render(<LandPreviewPanel preview={PENDING} />);
    expect(screen.getByTestId("land-cascade-clean-badge").textContent).toBe(
      "yes"
    );
  });
});

describe("LandPreviewPanel — cross-repo sibling cascades", () => {
  it("renders nothing when sibling_cascades is absent (older rows)", () => {
    const noSiblings: LandPreviewResponse = {
      repo: "qontinui/qontinui-coord",
      pr_number: 1,
      predicted: {
        cascade: { dependent_refs_to_restack: [], expected_conflicts: [] },
      },
      risk: { risky: false, reasons: [] },
    };
    render(<LandPreviewPanel preview={noSiblings} />);
    expect(
      screen.queryByTestId("land-sibling-cascades-section")
    ).toBeNull();
    expect(screen.queryByTestId("land-sibling-cascade-card")).toBeNull();
  });

  it("renders nothing when sibling_cascades is an empty array (single-repo land)", () => {
    const empty: LandPreviewResponse = {
      repo: "qontinui/qontinui-coord",
      pr_number: 1,
      predicted: {
        cascade: { dependent_refs_to_restack: [], expected_conflicts: [] },
        sibling_cascades: [],
      },
      risk: { risky: false, reasons: [] },
    };
    render(<LandPreviewPanel preview={empty} />);
    expect(
      screen.queryByTestId("land-sibling-cascades-section")
    ).toBeNull();
  });

  it("renders a sub-card per sibling with repo/branch/correlated_via + conflict chips", () => {
    const withSiblings: LandPreviewResponse = {
      repo: "qontinui/qontinui-coord",
      pr_number: 7,
      predicted: {
        cascade: { dependent_refs_to_restack: [], expected_conflicts: [] },
        sibling_cascades: [
          {
            repo: "qontinui/qontinui-web",
            branch: "feat/sibling-a",
            correlated_via: "proposal",
            cascade: {
              dependent_refs_to_restack: ["agent/dep-1", "agent/dep-2"],
              cascade_depth: 1,
              expected_conflicts: [
                {
                  child_ref: "agent/dep-1",
                  paths: ["src/x.ts"],
                  hunk_overlaps: 2,
                  auto_resolvable: true,
                },
              ],
            },
          },
        ],
      },
      risk: { risky: false, reasons: [] },
    };
    render(<LandPreviewPanel preview={withSiblings} />);
    const cards = screen.getAllByTestId("land-sibling-cascade-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("qontinui/qontinui-web");
    expect(cards[0].textContent).toContain("feat/sibling-a");
    expect(screen.getByTestId("land-sibling-correlated-via").textContent).toBe(
      "proposal"
    );
    expect(cards[0].textContent).toContain("depth 1");
    expect(cards[0].textContent).toContain("2 dependent refs");
    // ConflictChip reused as-is renders the child_ref + hunk overlaps.
    const chip = screen.getByTestId("land-conflict-chip");
    expect(chip.textContent).toContain("agent/dep-1");
    expect(chip.textContent).toContain("2 hunk overlaps");
  });

  it("renders defensively when a sibling's cascade is null", () => {
    const nullCascade: LandPreviewResponse = {
      repo: "qontinui/qontinui-coord",
      pr_number: 8,
      predicted: {
        cascade: { dependent_refs_to_restack: [], expected_conflicts: [] },
        sibling_cascades: [
          {
            repo: "qontinui/qontinui-runner",
            branch: "feat/sibling-b",
            correlated_via: "work_plan",
            cascade: null,
          },
        ],
      },
      risk: { risky: false, reasons: [] },
    };
    render(<LandPreviewPanel preview={nullCascade} />);
    const card = screen.getByTestId("land-sibling-cascade-card");
    expect(card.textContent).toContain("qontinui/qontinui-runner");
    expect(card.textContent).toContain("0 dependent refs");
    expect(screen.getByTestId("land-sibling-correlated-via").textContent).toBe(
      "work_plan"
    );
  });
});
