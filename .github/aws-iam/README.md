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
| `verify-frontend-deploy.yml` / `verify` | `qontinui-web-verify-frontend` | 3600 s |
| `db-credential-drift.yml` / `drift-check` | `qontinui-web-db-drift` | 3600 s |
| `oneoff-seed-claude-accounts.yml` / `seed` | `qontinui-web-oneoff-task` | 3600 s |

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

`verify-frontend-deploy` runs on `deployment_status` events that Vercel
creates by commit SHA, so its ref is not stable. Its role is therefore pinned
to the workflow path with any ref, and holds only three eu-central-1 SSM reads.
Residual: anyone who can push a branch to this repo can run a modified copy of
that workflow file and read those three parameters. That is strictly narrower
than the admin key the workflow used before.

## Apply / recreate

```bash
aws iam update-assume-role-policy --role-name <role> \
  --policy-document file://.github/aws-iam/<role>.trust.json
aws iam put-role-policy --role-name <role> \
  --policy-name <role without the qontinui- prefix>-least-privilege \
  --policy-document file://.github/aws-iam/<role>.policy.json
# from scratch:
# aws iam create-role --role-name <role> --max-session-duration <see table> \
#   --assume-role-policy-document file://.github/aws-iam/<role>.trust.json
```

Adding an AWS call to a workflow means adding it to that role's policy first.
Plan: `2026-09-29-retire-the-admin-aws-key-ci-and-the-operator-box-share`.
