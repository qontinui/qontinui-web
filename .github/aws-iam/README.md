# GitHub Actions → AWS: OIDC roles

Every AWS-using workflow in this repo assumes its own IAM role by GitHub OIDC
(`aws-actions/configure-aws-credentials` + `role-to-assume`, job permission
`id-token: write`). No workflow reads a stored AWS access key.

These files are the live trust and inline-policy documents, read back from
IAM (account 047719635665) when the roles were created. Git is the source of
truth: edit a file here, then apply it.

| Workflow / job | Role | Session |
|---|---|---|
| `deploy-web.yml` / `deploy` | `qontinui-web-deploy` | 7200 s |
| `migrate.yml` / `migrate` | `qontinui-web-migrate` | 3600 s |
| `verify-frontend-run.yml` / `validate` and `verify` (on push to `main`) | `qontinui-web-verify-frontend` | 3600 s |
| `db-credential-drift.yml` / `drift-check` | `qontinui-web-db-drift` | 3600 s |
| `oneoff-seed-claude-accounts.yml` / `seed` | `qontinui-web-oneoff-task` | 3600 s |

Session is the session length the workflow requests
(`role-duration-seconds`), which the role's `--max-session-duration` must
allow: `deploy` requests 7200 s, every other job takes the action's 3600 s
default.

## The subject each role trusts

This repo customizes its OIDC `sub` claim to
`include_claim_keys: ["repo", "context", "job_workflow_ref"]`
(`gh api repos/qontinui/qontinui-web/actions/oidc/customization/sub`), so a
token's subject names the exact workflow file and the ref it ran from, e.g.

    repo:qontinui/qontinui-web:ref:refs/heads/main:job_workflow_ref:qontinui/qontinui-web/.github/workflows/db-credential-drift.yml@refs/heads/main

Each role trusts only its own workflow file. The `production`-environment jobs
(deploy, migrate, seed) additionally require `environment:?roduction` (either
casing) and `@refs/heads/main`. **Reverting the customization to the default
template breaks every role here.**

The frontend verify (`verify-frontend-run.yml`) runs on `push` to `main`,
plus `workflow_dispatch` for a manual re-smoke, which its `validate` job
refuses unless it was dispatched on `refs/heads/main`. Both triggers
therefore run `main`'s copy of the file, and both of its jobs assume
`qontinui-web-verify-frontend`. `validate` reads the Vercel token to
resolve the production deployment of the pushed commit from the Vercel API.
`verify` reads it and the ci-bot login to smoke and roll back. The role
trusts only this file at `refs/heads/main`, so no branch, fork or preview
commit can produce its subject.

It used to be split in two (plan
2026-09-29-retire-the-admin-aws-key-ci-and-the-operator-box-share, review
finding S1). The trigger was Vercel's GitHub `deployment_status` event, and
GitHub runs a `deployment_status` workflow from the deployment's commit,
branch and preview commits included. So the trigger file held no AWS access
and only dispatched the run file on `main`. Vercel turned out to write that
deployment record for only about one production deploy in six, so the
trigger and its dispatcher (`verify-frontend-deploy.yml`) were deleted (plan
2026-10-02-frontend-post-deploy-smoke-misses-most-production-deploys). With
it gone, no AWS-holding job runs any copy of a workflow file but `main`'s.
A production deploy that no push to `main` created (a manual Vercel
redeploy or promote) is not smoked automatically; re-smoke it with
`gh workflow run verify-frontend-run.yml --ref main -f sha=<sha>`.

Vercel still deploys branch and preview commits, and GitHub still emits
`deployment_status` for them, so any workflow file at such a commit that
listens for that event runs in THIS repo's context: it can reference any
**repo-level** secret and request write scopes for the job token. The role,
the SSM parameters and the Vercel token are out of its reach (the role
trusts only `verify-frontend-run.yml` at `refs/heads/main`). Two things keep
the rest small:

- **Keep no secret at repo level that such a copy could abuse.** The unused
  `SPEC_CI_AUTH_EMAIL` / `SPEC_CI_AUTH_PASSWORD` repo secrets were deleted on
  2026-09-30 (the ci-bot login lives in SSM). The static
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` repo secrets are deleted in
  Phase 4 of the plan, once no workflow reads them.
- **Vercel Git Fork Protection must stay ON** for the `qontinui-web` Vercel
  project (read 2026-09-30: `gitForkProtection: true`). It is the only gate
  that stops a fork PR's commit from being deployed, and so from running this
  file with base-repo secrets.

## Apply / recreate

```bash
aws iam update-assume-role-policy --role-name <role> \
  --policy-document file://.github/aws-iam/<role>.trust.json
aws iam put-role-policy --role-name <role> \
  --policy-name <role without the qontinui- prefix>-least-privilege \
  --policy-document file://.github/aws-iam/<role>.policy.json
# from scratch (prerequisite: the account's GitHub OIDC provider,
# arn:aws:iam::047719635665:oidc-provider/token.actions.githubusercontent.com,
# with client id / audience sts.amazonaws.com; every trust file names it):
# aws iam create-role --role-name <role> --max-session-duration <see table> \
#   --assume-role-policy-document file://.github/aws-iam/<role>.trust.json
# then run the put-role-policy command above. create-role attaches no
# permissions, so the role can do nothing until that step runs.
```

Adding an AWS call to a workflow means adding it to that role's policy first.
Plan: `2026-09-29-retire-the-admin-aws-key-ci-and-the-operator-box-share`.
