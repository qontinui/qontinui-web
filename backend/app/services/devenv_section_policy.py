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
    # Which repositories the environment expects. Cloning is additive and
    # reversible-by-deletion, so this section is destined for ``applyable`` —
    # but NOT until the runner ships ``env_agent/apply_repos.rs`` (the repos
    # plan's P3). The runner's driver returns ``Unsupported`` for an applyable
    # section with no module, while its plan renderer simultaneously announces
    # "N change(s) are in applyable sections — re-run with --confirm": marking
    # it applyable early makes the box advertise an apply it cannot perform.
    # The drift surface — the whole value of P1/P2 — renders identically under
    # ``report_only``, so the promise buys nothing until the module exists.
    # Flip this to "applyable" in the same change that adds the module.
    "repos": "report_only",
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
            # Capture PROVENANCE, not a fact about the toolchain: which scope
            # the ``node``/``python``/``rustc`` probes were measured in
            # (``default`` = the box's home directory, i.e. its default
            # toolchain; ``declared`` = an operator-declared project tree;
            # ``inherited`` = no home directory resolvable). Emitted by the
            # runner's ``collect_versions``.
            #
            # It is classified "derived" for the same operational reason the
            # repo-derived keys are: it is REPORTED but is never an apply
            # action — no version manager can install a scope. It differs in
            # WHY, which is worth stating: the repo keys converge by pulling
            # the repo, whereas this one converges by an operator running
            # ``env scope-root`` on one of the two boxes.
            #
            # It exists so a runner can tell whether canonical's toolchain
            # numbers are even COMPARABLE with its own before acting on them.
            # Two boxes measuring different scopes are not measuring the same
            # thing, and the runner's ``versions`` apply refuses on a mismatch
            # rather than installing a version that was observed somewhere
            # else (plan 2026-07-02-..., the residual slice 1a left open).
            "probe_scope_kind",
        }
    ),
    "repos": frozenset(
        {
            # Capture PROVENANCE again, and registered here for a reason that is
            # easy to miss: ``_DERIVED_KEYS`` is keyed by SECTION, and
            # ``is_derived_key`` conservatively answers False for a key it does
            # not recognise. So the ``"versions"`` entry above does NOT cover a
            # same-named key in another section. Without this entry the runner
            # would count a workspace-root provenance difference as an
            # actionable change — offering to "clone" a scope marker — the
            # moment ``repos`` becomes ``applyable``.
            #
            # It names WHICH KIND of workspace-root resolution the repo
            # observations were taken under (``declared`` = an explicit
            # ``$QONTINUI_ROOT`` / setting was honoured; ``discovered`` = the
            # ancestor walk found the caller's own repo; ``home_default`` =
            # ``<home>/qontinui-root``; ``unresolved``). Two boxes that resolved
            # different KINDS did not enumerate the same concept, so this is
            # what lets a runner tell whether canonical's repo list is even
            # COMPARABLE with its own before acting on it.
            #
            # Derived for the same operational reason ``probe_scope_kind`` is:
            # it is REPORTED but is never an apply action — no clone can install
            # a scope. It converges by an operator setting the workspace root on
            # one of the two boxes.
            "repos_scope_kind",
        }
    ),
}

# Per-dependency keys are built as ``format!("node_dep_{dep}")`` by the
# collector, so the whole prefix is repo-derived.
#
# ``python_dep_`` is the Python twin, built as ``format!("python_dep_{dep}")``
# by the same collector from the dependency manifest it resolves for the
# capturing binary. Like ``node_dep_``, the stored value is the DECLARED
# CONSTRAINT out of that manifest, not an installed version — so it is derived
# for exactly the reason ``node_dep_`` is: it measures WHICH SOURCE TREE the
# binary was built from, not the box, and it converges by pulling the repo
# rather than by an apply. It therefore gets the
# same treatment as ``node_dep_``: reported with ``derived=True`` at ``info``
# severity and excluded from ``in_sync``, never actionable drift.
#
# WHAT THIS PREFIX DOES **NOT** DO, so nobody mistakes it for parity proof:
# because the value is a declared constraint out of a COMMITTED manifest, two
# boxes at the same commit agree here no matter what is actually installed in
# their environments. So ``python_dep_*`` can never answer "do these two boxes
# have the same packages installed" — and being derived, it is excluded from
# ``in_sync``, so it cannot make a divergent box look drifted either. An
# INSTALLED-inventory signal is a separate, BOX-level fact and must NOT be
# registered here: registering it would classify it ``info`` and drop it out of
# ``in_sync``, re-creating the exact "reports clean while measuring nothing"
# failure that motivated capturing Python at all.
#
# ORDERING CONSTRAINT — do not delete this registration, and do not let a
# runner emit ``python_dep_*`` before it is live. This policy is
# server-authoritative (see the module docstring): it is delivered to every box
# alongside the pulled config, and ``is_derived_key`` conservatively answers
# False for a prefix it does not recognise. So a runner that emits
# ``python_dep_*`` against a server without this entry does not fail loudly —
# every Python dependency on every machine silently reclassifies as actionable
# drift in the ``applyable`` ``versions`` section, and each box advertises an
# "apply" for package versions it has no apply path for. That is the same trap
# ``repos_scope_kind`` documents above, and the reason this classifier change
# must land BEFORE the collector change that emits the keys.
_DERIVED_KEY_PREFIXES: dict[str, tuple[str, ...]] = {
    "versions": ("node_dep_", "python_dep_"),
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
