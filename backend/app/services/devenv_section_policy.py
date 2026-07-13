"""Per-section apply policy for the devenv pull model.

When a runner pulls the canonical config to reconcile its own box toward it
(plan ``2026-07-02-devenv-copy-canonical-config-phase2-agent-apply``, P2), it
needs to know what it is *allowed* to do with each section — which are safe to
apply, which are presence-only secrets it can only report, and which are
destructive and must stop for a local human confirm. This classification is
**server-authoritative** (delivered alongside the pulled config) so the policy
lives in one place instead of being hardcoded on every box.

The policy is deliberately conservative: anything unrecognized defaults to
``report_only`` (surface the drift, never auto-change).
"""

from __future__ import annotations

from app.schemas.devenv import ENV_CONTRACT_SECTION, SectionPolicyT

# Explicit classification of the known capture sections. Unknown sections fall
# through to the conservative ``report_only`` default (see ``policy_for``).
_SECTION_POLICY: dict[str, SectionPolicyT] = {
    # Toolchain/runtime versions and local service topology are what a box can
    # actually converge (install via its version manager, align service config)
    # under a local plan-first + confirm flow.
    "versions": "applyable",
    "services": "applyable",
    # env_contract is stored present/absent only — the box can flag which
    # secrets are missing but can never copy a value.
    ENV_CONTRACT_SECTION: "secret_report_only",
    # Schema/migrations are destructive; a box must stop and defer to a human.
    "db_schema": "destructive_confirm",
    # Account roster: identity-bound; informational, not auto-applied.
    "claude_accounts": "report_only",
}


def policy_for(section: str) -> SectionPolicyT:
    """Return the apply policy for a section name (conservative default)."""
    return _SECTION_POLICY.get(section, "report_only")


def policy_map(sections: list[str]) -> dict[str, SectionPolicyT]:
    """Return ``section -> policy`` for the given section names."""
    return {name: policy_for(name) for name in sections}
