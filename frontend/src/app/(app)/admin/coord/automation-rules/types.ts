/**
 * Automation Rules (unified-automation-rule framework) — shared types.
 *
 * These mirror the coord `/coord/policies` contract (Rust
 * `src/policies/{mod,routes}.rs`). The web backend forwards them verbatim
 * through the tenant-admin coord-proxy (`/api/v1/operations/coord/policies`);
 * coord owns the kind→storage mapping (a `terminal_auto_response` rule is
 * persisted as the v2 `decision_domain` shape and reconstructed on read), so
 * the UI authors with the TYPED `kind`/`condition`/`action` shape and reads
 * the same kind back.
 *
 * Replaces the org-scoped #580 `AutoResponseRule` types (deleted in the
 * Phase 5 cutover). The BackoffConfig field names stay in lockstep with the
 * runner's `BackoffConfig` so the runner-rules projection round-trips.
 */

/** Exponential-backoff schedule for a terminal-regex rule. */
export interface BackoffConfig {
  initial_delay_secs: number;
  multiplier: number;
  /** null = unbounded (no cap on the delay between re-fires). */
  max_delay_secs: number | null;
}

/** Sensible defaults for a brand-new terminal rule's backoff schedule. */
export const DEFAULT_BACKOFF: BackoffConfig = {
  initial_delay_secs: 60,
  multiplier: 2,
  max_delay_secs: null,
};

/** Trigger discriminator the UI offers. Maps 1:1 to a coord `PolicyKind`. */
export type RuleKind = "terminal_auto_response" | "question_auto_answer";

/**
 * Resolution strategy discriminator (drives the action sub-form).
 *  - `fixed`   → `submit_prompt` (terminal) / `auto_answer` (question)
 *  - `scoring` → `resolve_by_scoring`
 *  - `meta`    → `meta_answer` (the standing decision-delegation catch-all;
 *    edited as a token template)
 */
export type ResolutionKind = "fixed" | "scoring" | "meta";

/** A single scored option for a `resolve_by_scoring` action. */
export interface PolicyOption {
  id: string;
  label: string;
}

/**
 * Condition tree (coord `PolicyCondition`, `#[serde(tag = "type")]`). The UI
 * authors `terminal_regex_match` (terminal trigger) and `question_match`
 * (agent-question trigger).
 */
export type PolicyCondition =
  | {
      type: "terminal_regex_match";
      pattern: string;
      case_insensitive?: boolean;
      backoff?: BackoffConfig;
    }
  | {
      type: "question_match";
      question_contains?: string[];
      context_contains?: string[];
      plan_phase?: string;
    };

/**
 * Action (coord `PolicyAction`, `#[serde(tag = "type")]`). The UI authors
 * `submit_prompt` (fixed text) and `resolve_by_scoring` (options + surface).
 */
export type PolicyAction =
  | { type: "submit_prompt"; text: string }
  | { type: "resolve_by_scoring"; options: PolicyOption[]; surface: string }
  | { type: "auto_answer"; response: string }
  /**
   * Agent Q&A meta-answer: the standing decision-delegation catch-all. The
   * `template` carries `{{policy:<handle>}}` / `{{twin-catalog}}` tokens coord
   * expands per tenant at answer time (coord `PolicyAction::MetaAnswer`,
   * serializes to `{"type":"meta_answer","template":"..."}`).
   */
  | { type: "meta_answer"; template: string };

/** `POST /coord/policies` body (coord `CreatePolicyRequest`). */
export interface PolicyCreate {
  name: string;
  kind: RuleKind;
  condition: PolicyCondition;
  action: PolicyAction;
  priority?: number;
  rationale?: string;
}

/** `PATCH /coord/policies/:id` body (coord `UpdatePolicyRequest`). */
export interface PolicyUpdate {
  name?: string;
  kind?: RuleKind;
  condition?: PolicyCondition;
  action?: PolicyAction;
  priority?: number;
  enabled?: boolean;
  rationale?: string;
  /**
   * The §8 autonomy dial. Settable ONLY via PATCH (coord#920) — create takes the
   * shadow-safe default. Graduating a question-scoring rule to `auto_decide` is
   * what makes it actually auto-answer (`acted=true`); `guidance_only` /
   * `always_escalate` keep it in shadow.
   */
  autonomy_level?: "always_escalate" | "guidance_only" | "auto_decide";
}

/**
 * A policy row as returned by `GET /coord/policies` (coord `PolicyRow`). The
 * mode-aware shape: `kind` is a (possibly null) string, `condition`/`action`
 * are raw JSON. For a terminal rule coord reconstructs
 * `kind = "terminal_auto_response"` from the v2 storage shape.
 */
export interface PolicyRow {
  policy_id: string;
  tenant_id: string;
  repo: string | null;
  name: string;
  kind: string | null;
  decision_domain: string | null;
  mode: string;
  autonomy_level: string;
  payload: unknown | null;
  condition: PolicyCondition | Record<string, never>;
  action: PolicyAction | Record<string, never>;
  priority: number;
  enabled: boolean;
  rationale: string | null;
  /**
   * The code constant this row was seeded from (e.g. `agent_meta_answer/v1`),
   * naming the canonical default the restore-default route re-seeds from. `null`
   * for hand-authored rows — the Restore-to-default control is shown only when
   * this is non-null (coord `EffectivePolicy.default_source`).
   */
  default_source: string | null;
  expires_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

/** `GET /coord/policies` response. */
export interface ListPoliciesResponse {
  policies: PolicyRow[];
  total: number;
}

/** Default surface for a scoring resolution (the priority-set composition surface). */
export const DEFAULT_SCORING_SURFACE = "agent_question";
