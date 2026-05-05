<!-- BEGIN License & CLA preamble — added 2026-04-29 during AGPL rollout -->
## License & CLA

This project is licensed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE) for the full text. Contributors should be aware:

- AGPL is a strong copyleft license. Anyone who runs a modified version of this project as a network service must publish their modifications under AGPL too.
- For typical self-hosting, internal use, forking, or contributing back, AGPL behaves like GPL.

All non-trivial contributions require signing the qontinui Contributor License Agreement (CLA). The CLA is administered via [cla-assistant.io](https://cla-assistant.io/) — when you open a pull request, the CLA bot will comment with a one-click sign link, and signing applies across all qontinui repositories. The CLA text lives in [`CLA.md`](CLA.md). It grants Joshua Spinak the right to relicense your contribution under any future license; you retain copyright in your contributions.

The remainder of this document covers contribution mechanics specific to this repository.

<!-- END License & CLA preamble -->

# Contributing to Qontinui Web

We love your input! We want to make contributing to this project as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## We Develop with Github

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

## We Use Github Flow

Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Any contributions you make will be under the project's license

When you submit code changes, your submissions are understood to be under the same AGPL-3.0-or-later license that covers the project, plus the relicensing grant in the [CLA](CLA.md). Feel free to contact the maintainers if that's a concern.

## Report Bugs Using GitHub's Issues

We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/qontinui/qontinui-web/issues).

## Write Bug Reports with Detail, Background, and Sample Code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

## Development Setup

1. Clone the repository
2. Install dependencies (see README.md)
3. Run tests to ensure everything is working
4. Make your changes
5. Run tests again to verify your changes

## Code Style

- Follow the existing code style in the project
- Run linters before committing
- Write clear, descriptive commit messages
- Add comments for complex logic

## CI & Merge Readiness

A PR is ready to merge when every required workflow is green on the PR's HEAD commit. Don't merge through red, and don't assume someone else's red is "fine" because `main` is also red — that's how `main` ended up with 20/20 failure on three separate workflows over the course of late April / early May 2026, each for a different reason and each with no documented owner. Most of those layers have since been peeled (see "Currently-tracked pre-existing red" below for the live snapshot), but the discipline that surfaced them is what this document is for.

### What "main is green" means here

This repo has six workflows. They split into tiers by trigger type and load-bearing role:

**Merge gates** (must be green on your PR before merge):

- `e2e-tests.yml` — runs on PR + push to `main`/`develop` (no paths filter; see `e2e-tests.yml:3-8`). Three jobs: `Backend E2E Tests` (pytest with coverage), `Frontend E2E Tests` (Playwright + alembic-migrated postgres + sibling-repo clones of `qontinui-schemas` + `qontinui` for `pyproject.toml` path-deps), and `Full Stack Integration Tests` (gated on the prior two). The most load-bearing gate.
- `frontend-ci.yml` — runs on PR + push to `main`/`develop`, paths-filtered to `frontend/**` and `.github/workflows/frontend-ci.yml` (see `frontend-ci.yml:3-13`). Lint + TypeScript check. Cheap, fast, no excuse for letting it go red.
- `backend-ci.yml` — runs on PR to `main`/`develop` + push to `develop` only, paths-filtered to `backend/**` and `.github/workflows/backend-ci.yml` (see `backend-ci.yml:3-12`). Lint + tests + security scan + Docker build. Note: never fires on `push` to `main` (only develop), which means the `--branch main` audit will misleadingly show zero runs. Always audit across-branches.
- `forbid-public-schema.yml` — runs on PR + push to `main`/`develop` (see `forbid-public-schema.yml:21-25`). Cheap schema-regression gate. No excuse for red.

**Conditional gates** (run only when their paths match — required when they run, irrelevant when they don't):

- `alembic-graph-check.yml` — runs on `push: main`, paths-filtered to `backend/alembic/versions/**` (see `alembic-graph-check.yml:13-17`). Post-merge informational comment workflow that warns when the alembic chain forks. **Note:** because it only runs after merge, a contributor opening a PR with a duplicate revision id won't see the warning until the merge has already landed. This is structural — the workflow is helpful but not preventive.

**Not merge gates** (validated separately, not on PR):

- `backend-deploy-production.yml` — `workflow_dispatch` only (see `backend-deploy-production.yml:3-4`). Uses `environment: production`. Runs on demand to deploy to AWS Elastic Beanstalk. The matching sibling-clone step (`Checkout sibling repos` at `backend-deploy-production.yml:31-35`) clones public repos `qontinui/qontinui-schemas` and `qontinui/qontinui` to satisfy `backend/pyproject.toml`'s path-deps on a clean GH runner. Because the trigger is now manual, its run count on `main` is no longer a merge-readiness signal; check it before promoting a release, not before merging a PR.

### Hidden-red discipline

`main` had three workflows simultaneously at 20/20 failure for an extended window in late April / early May 2026 (an extended audit found the `e2e-tests.yml` streak ran ~352 consecutive failures starting 2025-11-16). That means a CI failure on your PR may still be a layer of pre-existing breakage you didn't cause. Even with most of those layers now peeled, the discipline below should be the default — checking takes a minute and prevents the "CI is always red" rot from coming back. Before you assume your PR caused a failure (or, worse, assume your PR is innocent because "CI is always red"), do this:

1. Pull up the latest run of the same workflow on `main`:

   ```bash
   gh run list --repo qontinui/qontinui-web --branch main --workflow=<name> --limit 5
   gh run view <run-id> --log-failed
   ```

2. Compare your PR's failing job to `main`'s most recent failing job for the same workflow.

   - **Symptom matches** → not your PR. Note this in the PR description, link the open plan or issue that owns the fix, and proceed.
   - **Symptom is new** → it's yours. Fix before merge.
   - **You can't tell** → check out a fresh `main`, push it to a throwaway branch, and see what CI does on a clean baseline. If the symptom appears there too, it's not yours.

3. **Watch for false-cause traps in logs.** When `e2e-tests.yml` was last broken on the alembic graph fork, the failed-step log printed `FATAL: role "root" does not exist` repeatedly at the *end* — but those lines came from background postgres health probes that ran throughout the job and were only flushed to stdout *after* the real failure. The actual cause (`Revision a3b4c5d6e7f8 is present more than once` from `alembic upgrade heads`) was several lines higher. Read the *first* error in the log, not the last.

Don't merge red without doing this comparison. "Same as main" is a real answer, but it has to be a verified answer linked to a tracked owner.

### Currently-tracked pre-existing red

Resolved layers (kept here for audit trail; if any of these symptoms reappears, the linked context is the starting point):

- ✅ **`e2e-tests.yml` `Run database migrations` step**: alembic graph fork (`a3b4c5d6e7f8` duplicate + `add_arq_job_id_to_training_jobs` framing). Resolved in PR #43 — the duplicate `a3b4c5d6e7f8` revision was renamed to `f9d3e8a4c1b6`. The cosmetic-but-not-blocking new orphan from the rename was folded back into the chain in PR #45.
- ✅ **`frontend-ci.yml` `Install dependencies` step**: lockfile drift (`Missing: @qontinui/ui-bridge-auto@... from lock file`). Resolved in PR #40 by bumping `package.json` and refreshing `package-lock.json` in the same commit. If you bump `@qontinui/*` versions, refresh the lockfile in the same commit or `npm ci` will reject it.
- ✅ **`verify-alembic-claim.yml` workflow file failure**: workflow + companion script `scripts/verify_alembic_claim.py` deleted in PR #41. The Phase-5C multi-machine coord plan it implemented was decommissioned; nothing replaced it.

Still red, in active follow-up — do NOT just merge through these without linking the owning PR/plan in your PR description:

- 🟡 **`backend-ci.yml` `Run Tests` job**: original lockfile-drift install gate was unmasked when the lockfile was regenerated in PR #44; ruff format gap from the same era resolved in PR #46. What remains is a substantive split: missing `cloud` schema in test DB and a Linux-side timeout-test rewrite. Tracked across the open follow-up PRs.
- 🟡 **`e2e-tests.yml` `Frontend E2E Tests (20)` job (post-alembic)**: after the alembic fix landed, the next layer was an RSC client/server boundary error in `use-discovered-specs.ts` (`Error: Attempted to call loadDiscoveredSpecs() from the server but loadDiscoveredSpecs is on the client`). Split into a universal loader module + client hook in the open RSC-split PRs; a separate seeder PYTHONPATH issue was fixed in PR #53. Watch the next push to `main` to confirm the frontend leg goes fully green.

A failing leg may be temporarily exempted from the merge gate **if and only if** there's an open tracked plan or issue documenting the block, linked in your PR description. Exemptions decay the moment the linked workstream closes; recheck before merging.

### Test locally first

For everything you can run locally, run it before pushing — the feedback loop is much faster than waiting on CI, and a local failure means CI failure too. The reverse isn't always true: local can pass while CI fails on something CI-environment-specific (sibling-repo clone failures, secrets-only deploys, etc.). So local-first is a productivity practice, not a CI replacement.

```bash
# Frontend lint + typecheck + build
cd frontend && npm run lint && npm run typecheck && npm run build

# Backend lint + tests
cd backend && poetry run ruff check . && poetry run pytest

# Alembic chain integrity (fast — won't catch every issue but catches forks)
cd backend && poetry run alembic heads   # should print exactly one head
```

If `alembic heads` prints more than one line, the chain is forked and `e2e-tests.yml` will fail on your PR — fix the fork before pushing.

### Active workstream awareness

CI is a shared surface. Before opening a PR that touches `.github/workflows/` or anything CI-adjacent, check what's already in flight:

```bash
gh pr list --repo qontinui/qontinui-web --state open
```

If you find a related open PR, coordinate (or rebase onto it) rather than opening a parallel attempt.

### Branch protection — note for follow-up

Ideally, GitHub branch protection on `main` would mirror the merge-gate set above (`e2e-tests.yml` + `frontend-ci.yml` + `backend-ci.yml` + `forbid-public-schema.yml` + the path-triggered gates when they run). Aligning protection rules with this policy is a follow-up. Note that the "tracked-exemption" pattern described above is human-enforced (you check the linked exemption before merging) — GitHub branch protection can't natively express "green OR linked open plan," so this part of the policy lives in the PR-review discipline, not the protection rules.

### Quick checklist before clicking merge

- [ ] Local lint / typecheck / tests passed on whatever you changed (`npm run lint && npm run typecheck` for frontend; `ruff check && pytest` for backend)
- [ ] `alembic heads` returns exactly one head (only relevant if your PR touched `backend/alembic/versions/**`)
- [ ] `e2e-tests.yml` green, OR red matches a tracked exemption per "Currently-tracked pre-existing red" linked in your PR description
- [ ] `frontend-ci.yml` green
- [ ] `backend-ci.yml` green (or red matches the tracked `Run Tests` follow-up and you've linked it)
- [ ] `forbid-public-schema.yml` green
- [ ] `alembic-graph-check.yml` green if it ran (only fires on push to `main` after a `backend/alembic/versions/**` change — won't run on PR review)
- [ ] Any new red compared against current `main` and either confirmed-not-yours-with-link or fixed
- [ ] No open PR is doing the same work

## Community

- Be respectful and inclusive
- Follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- Help others in issues and discussions

## License

By contributing, you agree that your contributions will be licensed under the same GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) that covers the project, and you agree to the additional relicensing grant in the [CLA](CLA.md).

## Questions?

Feel free to contact the maintainer at jspinak@hotmail.com or open an issue for discussion.
