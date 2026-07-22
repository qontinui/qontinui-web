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


# ---------------------------------------------------------------------------
# Per-key refinement: repo-derived keys
# ---------------------------------------------------------------------------
#
# ``section_policy`` is per-SECTION, but appliability is per-KEY. The whole
# ``versions`` section is ``applyable``, yet several of its keys are parsed
# from the ``Cargo.toml``/``package.json`` next to the capturing binary's
# compile-time ``CARGO_MANIFEST_DIR``. They measure *which source tree the
# binary was built from*, not the box, and converge by pulling the repo rather
# than by an apply — so they are never actionable.
#
# Keys are declared explicitly (plus one prefix rule) and verified against the
# runner's ``env_agent/collectors.rs::collect_versions``: the machine facts
# ``node`` / ``python`` / ``rustc`` are shelled ``--version`` calls and stay
# applyable; everything else that section emits is repo-derived.

_DERIVED_KEYS: dict[str, frozenset[str]] = {
    "versions": frozenset(
        {
            "runner_crate_version",
            "node_package_version",
            "node_package_name",
            "python_constraint",
            "tauri",
        }
    ),
}

# Per-dependency keys are built as ``format!("node_dep_{dep}")`` by the
# collector, so the whole prefix is repo-derived.
_DERIVED_KEY_PREFIXES: dict[str, tuple[str, ...]] = {
    "versions": ("node_dep_",),
}


def is_derived_key(section: str, key: str) -> bool:
    """Return whether ``key`` in ``section`` is repo-derived.

    Conservative default: an unrecognized key is NOT derived, so a key we do
    not know about keeps its section policy and is never silently downgraded.
    """
    if key in _DERIVED_KEYS.get(section, frozenset()):
        return True
    return key.startswith(_DERIVED_KEY_PREFIXES.get(section, ()))


def derived_keys_map(sections: dict[str, dict[str, str]]) -> dict[str, list[str]]:
    """Return ``section -> repo-derived keys`` for a captured section map.

    Every section present in ``sections`` gets an entry (an empty list when it
    has no repo-derived keys), so a consumer can distinguish "classified, none
    derived" from "section absent".
    """
    return {
        name: [key for key in keys if is_derived_key(name, key)]
        for name, keys in sections.items()
    }
