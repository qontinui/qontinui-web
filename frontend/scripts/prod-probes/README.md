# prod-probes — live production verification probes

Three headless, read-only probes that drive **https://qontinui.io** through the
injected [`@qontinui/ui-bridge-wrapper`](https://www.npmjs.com/package/@qontinui/ui-bridge-wrapper)
transport (Playwright under the hood) and assert specific auth / session /
networking invariants on the **live production** site.

They were promoted into the repo from untracked `ui-bridge/_scratch/`
diagnostics that caught the **2026-06-07 sign-in P0** and verified web PRs
**#479 / #500 / #503 / #505 / #506 / #511**. Tracking them here keeps that
load-bearing tooling durable and pinned to the published wrapper instead of a
monorepo `dist/` path in a checkout that may be parked on a peer branch.

Each probe prints exactly **one JSON line** to stdout (its verdict) and logs
progress to stderr. Read-only navigation only — no destructive operations.

## Prerequisites

Run from `frontend/` after `npm install`. The injected transport needs the
optional headless peer and a Chromium binary (both pulled by `npm install` via
the declared devDependencies, except the browser binary):

```sh
npx playwright install chromium
```

### Credentials (for the two authenticated probes)

`probe:expired-session` and `probe:ws-spam` log in as the operator. Fetch the
credentials from SSM into the expected env vars — **never hardcode or echo
them**:

```sh
# Git Bash: MSYS_NO_PATHCONV=1 stops the /qontinui/... path being mangled.
export UIB_LOGIN_EMAIL="$(MSYS_NO_PATHCONV=1 aws ssm get-parameter \
  --name /qontinui/operator/email --with-decryption --region eu-central-1 \
  --query Parameter.Value --output text)"
export UIB_LOGIN_PASSWORD="$(MSYS_NO_PATHCONV=1 aws ssm get-parameter \
  --name /qontinui/operator/password --with-decryption --region eu-central-1 \
  --query Parameter.Value --output text)"
```

```powershell
# PowerShell: no path mangling, no MSYS_NO_PATHCONV needed.
$env:UIB_LOGIN_EMAIL = (aws ssm get-parameter --name /qontinui/operator/email `
  --with-decryption --region eu-central-1 --query Parameter.Value --output text)
$env:UIB_LOGIN_PASSWORD = (aws ssm get-parameter --name /qontinui/operator/password `
  --with-decryption --region eu-central-1 --query Parameter.Value --output text)
```

`login-churn` is anonymous and needs no credentials.

---

## probe:login-churn

**File:** `login-churn-probe.cjs` · **Creds:** none

Loads `qontinui.io/login` in a fresh headless context and counts full main-frame
navigations + classified console hits (refresh-attempt / halt-redirect / 401)
over 30s. A healthy login page navigates roughly once and shows the
"Continue with email" button — it does NOT churn through reloads/redirects.

Caught the 2026-06-07 sign-in P0 (the login page was navigation-thrashing).

**Run:**

```sh
npm run probe:login-churn
```

**Healthy output:**

```json
{"url":"https://qontinui.io/login","navsIn30s":0,"consoleCounts":{},"emailBtnVisible":true}
```

Contract: `navsIn30s <= 2` and `emailBtnVisible: true`.

---

## probe:expired-session

**File:** `expired-session-probe.cjs` · **Creds:** required

Post-#511 regression check that the #491 behavior (halt polling on a REAL dead
session) is intact. Logs in normally, then simulates a **mid-session** expiry —
**not** a reload (a reload routes through the boot-time auth gate before any
HttpClient call) and **not** a 401 (a 401 enters HttpClient's refresh branch
that returns without auto-logout). Instead it backdates `localStorage`
`token_expiry` and uses Playwright route interception to force backend API calls
to **403**, so the next poll tick sees: token present + expired + 403 → the halt
path. Asserts exactly one session-expiry halt warning, a redirect to `/login`,
and no reload loop once there.

**Run:**

```sh
npm run probe:expired-session
```

**Healthy output:**

```json
{"loginOk":true,"haltWarns":1,"refreshWarns":0,"redirected":true,"finalPath":"/login","navsAfterLoginRedirect":0,"verdict":"expiry-halt-intact"}
```

Contract: `verdict: "expiry-halt-intact"` (`haltWarns >= 1` AND
`finalPath` starts `/login` AND `navsAfterLoginRedirect <= 2`).

---

## probe:ws-spam

**File:** `ws-spam-check.cjs` · **Creds:** required

Verification for the "prod-page WS handshake 404 spam to localhost:9876-9878"
follow-up: a production page must never attempt to reach a local UI Bridge runner
(`localhost:987x`). Logs in, then observes `/build/workflows` (the authed
landing) for 30s and `/co-pilot` for 45s, counting any `localhost:987x`
WebSocket attempts, failed requests, or console errors.

**Run:**

```sh
npm run probe:ws-spam
```

**Healthy output:**

```json
{"loginOk":true,"landingPath":"/build/workflows","observed":[...],"localFailureCount":0,"verdict":"clean"}
```

Contract: `loginOk: true` and `verdict: "clean"` (zero `localhost:987x`
failures/WS errors observed).

---

## History

These probes originated as untracked diagnostics in `ui-bridge/_scratch/`
during the **2026-06-07 sign-in P0 investigation** and were used to verify the
fix chain (web PRs #479 / #500 / #503 / #505 / #506 / #511). Their assertion
logic and inline comments encode hard-won diagnostic lessons (e.g. why
expired-session uses a 403 route-fulfill and not a reload or a 401) — preserve
them when editing.
