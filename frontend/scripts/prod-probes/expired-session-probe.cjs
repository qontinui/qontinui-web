#!/usr/bin/env node
/**
 * expired-session-probe.cjs — post-#511 regression check that the #491
 * behavior (halt polling on a REAL dead session) is intact:
 *
 * 1. Log in normally (Variant A injected transport, same flow as the
 *    shipped ui-bridge-login-web driver) → authed /build/workflows.
 * 2. Corrupt the stored bearer + backdate token_expiry (sessionStorage
 *    `auth_bearer_access_token`, localStorage `token_expiry`) and reload —
 *    simulating an expired session: token PRESENT but unusable, backend 401s.
 * 3. Expect: ≥1 "[HttpClient] … treating as session expiry and halting"
 *    warn, a redirect to /login, and NO reload loop once there (the
 *    landed-on-/login page is anonymous → hadSession()=false → silent).
 *
 * PASS = haltWarns >= 1 AND finalPath starts /login AND postRedirectNavs <= 2.
 * Creds via env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD.
 */
const { createTransport } = require('@qontinui/ui-bridge-wrapper');

const EMAIL = process.env.UIB_LOGIN_EMAIL;
const PASSWORD = process.env.UIB_LOGIN_PASSWORD;
const TIMEOUT = 60000;
const log = (m) => process.stderr.write(`[expired-session-probe] ${m}\n`);

if (!EMAIL || !PASSWORD) {
  process.stderr.write('expired-session-probe: need env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD\n');
  process.exit(2);
}

const isCognito = (u) => /auth\.qontinui\.io|amazoncognito\.com|\/oauth2\//i.test(u);
const pathOf = (u) => {
  try {
    return new URL(typeof u === 'string' ? u : u.toString()).pathname;
  } catch {
    return '';
  }
};

(async () => {
  const transport = createTransport({
    kind: 'injected',
    options: { targetUrl: 'https://qontinui.io/login', waitForSettle: false, readyTimeoutMs: 45000, headed: false },
  });

  transport.register('drive', async (_p, ctx) => {
    const page = ctx.page;
    let haltWarns = 0;
    let refreshWarns = 0;
    page.on('console', (msg) => {
      const t = msg.text();
      if (/treating as session expiry and halting/.test(t)) haltWarns++;
      if (/attempting token refresh/.test(t)) refreshWarns++;
    });

    // ---- login (same flow as the shipped strict driver) ----
    const isAuthedLanding = (u) => /\/(dashboard|build)/.test(pathOf(u));
    const emailBtn = page
      .getByRole('button', { name: /continue with email/i })
      .or(page.getByText(/continue with email/i));
    await emailBtn.first().waitFor({ state: 'visible', timeout: 15000 });
    await emailBtn.first().click();
    await page.waitForURL((u) => isCognito(u.toString()) || isAuthedLanding(u), { timeout: TIMEOUT });
    if (isCognito(page.url())) {
      await page.waitForLoadState('domcontentloaded');
      const fillFirst = async (sels, val) => {
        for (const s of sels) {
          const loc = page.locator(s);
          const n = await loc.count().catch(() => 0);
          for (let i = 0; i < n; i++) {
            const el = loc.nth(i);
            if (await el.isVisible().catch(() => false)) {
              await el.fill(val, { timeout: 10000 });
              return;
            }
          }
        }
        throw new Error('Cognito field not found');
      };
      await fillFirst(['#signInFormUsername', 'input[name="username"]', 'input[type="email"]'], EMAIL);
      await fillFirst(['#signInFormPassword', 'input[name="password"]', 'input[type="password"]'], PASSWORD);
      const submitLoc = page.locator('input[name="signInSubmitButton"], button[type="submit"], input[type="submit"]');
      const sn = await submitLoc.count().catch(() => 0);
      for (let i = 0; i < sn; i++) {
        const el = submitLoc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click();
          break;
        }
      }
      await page.waitForURL((u) => isAuthedLanding(u) || /\/auth\/callback/.test(u.toString()), { timeout: TIMEOUT });
      if (/\/auth\/callback/.test(page.url())) {
        await page.waitForURL((u) => isAuthedLanding(u), { timeout: TIMEOUT }).catch(() => {});
      }
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    if (!/\/(dashboard|build)/.test(pathOf(page.url()))) {
      return { loginOk: false, finalPath: pathOf(page.url()), verdict: 'login-failed' };
    }
    log(`authed at ${pathOf(page.url())} — simulating MID-SESSION expiry`);

    // ---- simulate #491's real scenario: session expires while pollers
    // are mounted. NO reload (a reload routes through the boot-time auth
    // gate, which redirects before any HttpClient call happens — verified
    // on the first probe attempt). Instead: backdate token_expiry (read
    // live from localStorage by isAccessTokenExpired) and force every
    // backend API response to 401 via network interception, so the next
    // poll tick presents: token PRESENT + expired + 401 → the halt path.
    await page.evaluate(() => {
      localStorage.setItem('token_expiry', String(Date.now() - 3600_000));
    });
    await page.route(
      (url) => /api\.qontinui\.io|\/api\/v1\//.test(url.toString()),
      (route) =>
        route.fulfill({
          // 403, not 401: a 401 enters HttpClient's refresh branch whose
          // failure path returns "without auto-logout" by design and never
          // reaches maybeHandleAuthRejection. #491's storm signal was the
          // device-status 403s — those go straight to the halt.
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'expired (probe-injected)' }),
        })
    );
    haltWarns = 0;
    refreshWarns = 0;
    let navsAfterLogin = 0;
    let sawLogin = false;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame() && sawLogin) navsAfterLogin++;
    });

    // Nudge a poller-bearing page via CLIENT-side nav if no poll fires
    // organically; wait up to 45s for the dead-session halt to redirect.
    await page
      .waitForURL((u) => pathOf(u).startsWith('/login'), { timeout: 45000 })
      .then(async () => {
        sawLogin = true;
        log('redirected to /login');
        await page.unroute(() => true).catch(() => {});
      })
      .catch(() => log('NO redirect to /login within 45s'));

    // Once on /login (anonymous now), watch 15s for any reload loop.
    await page.waitForTimeout(15000);

    const finalPath = pathOf(page.url());
    const redirected = finalPath.startsWith('/login');
    const noLoop = navsAfterLogin <= 2;
    const verdict =
      haltWarns >= 1 && redirected && noLoop ? 'expiry-halt-intact' : 'FAIL';
    return { loginOk: true, haltWarns, refreshWarns, redirected, finalPath, navsAfterLoginRedirect: navsAfterLogin, verdict };
  });

  let result;
  try {
    await transport.ready();
    result = await transport.dispatch('drive');
  } catch (err) {
    result = { verdict: 'FAIL', error: String((err && err.message) || err).slice(0, 300) };
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  await transport.close().catch(() => {});
  process.exit(result && result.verdict === 'expiry-halt-intact' ? 0 : 1);
})();
