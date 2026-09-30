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
| `verify-frontend-run.yml` / `verify` (dispatched by `verify-frontend-deploy.yml`) | `qontinui-web-verify-frontend` | 3600 s |
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

The frontend verify is split in two because of how `deployment_status`
works. GitHub runs a `deployment_status` workflow from the deployment's
commit, and Vercel creates deployments by SHA for every commit it builds,
branch and preview commits included. A role trusted from that trigger would
have to trust any ref, so anyone who could get a commit deployed could run
a modified copy and read the Vercel token and the ci-bot login.

- `verify-frontend-deploy.yml` (`deployment_status`) holds no AWS access and
  no secrets. Its token has only `actions: write`, which it uses to dispatch
  `verify-frontend-run.yml` on `main` with the deployment id.
- `verify-frontend-run.yml` (`workflow_dispatch`) does not trust that id.
  Its `validate` job re-reads the deployment from the GitHub API and checks
  five things: the run is on `refs/heads/main`, the creator is `vercel[bot]`,
  the environment is Production, the latest status is `success`, and `main`
  contains the deployed SHA. It takes the URL and SHA from the API, not from
  the inputs. If any check fails, the run ends green with a notice. Only
  then does the `verify` job assume `qontinui-web-verify-frontend`, whose
  trust is pinned to this file at `refs/heads/main`.

So a branch or fork deployment can still run a modified trigger file. The
most it can do is dispatch the main-branch run for some deployment id, or do
what a `push`-triggered workflow on that branch could already do with the
job token. The main-branch run then smokes only a validated production
deployment of a commit on `main`, and it can roll back only to the prior
production deployment. The branch copy never holds the role, the SSM
parameters or the Vercel token.

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
