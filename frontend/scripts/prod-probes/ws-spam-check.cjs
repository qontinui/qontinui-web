#!/usr/bin/env node
/**
 * ws-spam-check.cjs — one-off prod verification for follow-up #3 (2026-06-05):
 * "prod-page WS handshake 404 spam to localhost:9876-9878".
 *
 * Logs into qontinui.io (same injected-transport Variant A flow as the shipped
 * ui-bridge-login-web bin, fixed strict version), then parks on /dashboard and
 * /co-pilot with console + websocket listeners, counting any WebSocket
 * handshake failures / console errors that mention localhost:9876-9878.
 *
 * Run from the ui-bridge repo root. Read-only navigation only.
 * Creds via env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD (SSM-fetched by caller).
 *
 * Prints ONE JSON line: {loginOk, observed:[{page, seconds, hits, wsAttempts}], verdict}
 * Exit 0 = login ok AND zero localhost-987x failures observed. Exit 1 otherwise.
 */
const { createTransport } = require('@qontinui/ui-bridge-wrapper');

const EMAIL = process.env.UIB_LOGIN_EMAIL;
const PASSWORD = process.env.UIB_LOGIN_PASSWORD;
const TIMEOUT = 60000;
const log = (m) => process.stderr.write(`[ws-spam-check] ${m}\n`);

if (!EMAIL || !PASSWORD) {
  process.stderr.write('ws-spam-check: need env UIB_LOGIN_EMAIL / UIB_LOGIN_PASSWORD\n');
  process.exit(2);
}

const isCognito = (u) => /auth\.qontinui\.io|amazoncognito\.com|\/oauth2\/|\/login\?/i.test(u);
const pathOf = (u) => {
  try {
    return new URL(typeof u === 'string' ? u : u.toString()).pathname;
  } catch {
    return '';
  }
};
const LOCAL_RUNNER = /(localhost|127\.0\.0\.1):987[0-9]/i;

(async () => {
  const transport = createTransport({
    kind: 'injected',
    options: {
      targetUrl: 'https://qontinui.io/login',
      waitForSettle: false,
      readyTimeoutMs: 45000,
      headed: false,
    },
  });

  transport.register('drive', async (_p, ctx) => {
    const page = ctx.page;

    // ---- listeners (attached for the whole session) ----
    const consoleHits = []; // console messages mentioning localhost:987x
    const wsAttempts = []; // every WebSocket the page opens
    page.on('console', (msg) => {
      const t = msg.text();
      if (LOCAL_RUNNER.test(t) || /websocket/i.test(t)) {
        consoleHits.push({
          at: pathOf(page.url()),
          type: msg.type(),
          text: t.slice(0, 300),
        });
      }
    });
    page.on('websocket', (ws) => {
      const rec = { url: ws.url().slice(0, 200), at: pathOf(page.url()), error: null, closed: false };
      wsAttempts.push(rec);
      ws.on('socketerror', (e) => {
        rec.error = String(e).slice(0, 200);
      });
      ws.on('close', () => {
        rec.closed = true;
      });
    });
    page.on('requestfailed', (req) => {
      if (LOCAL_RUNNER.test(req.url())) {
        consoleHits.push({
          at: pathOf(page.url()),
          type: 'requestfailed',
          text: `${req.url().slice(0, 200)} — ${req.failure()?.errorText ?? '?'}`,
        });
      }
    });

    // ---- login (same flow as the shipped strict login-web driver) ----
    log(`landed ${page.url()}`);
    const emailBtn = page
      .getByRole('button', { name: /continue with email/i })
      .or(page.getByText(/continue with email/i));
    await emailBtn.first().waitFor({ state: 'visible', timeout: 15000 });
    await emailBtn.first().click();

    const isAuthedLanding = (u) => /\/(dashboard|build)/.test(pathOf(u));
    await page.waitForURL((u) => isCognito(u.toString()) || isAuthedLanding(u), {
      timeout: TIMEOUT,
    });

    if (isCognito(page.url())) {
      await page.waitForLoadState('domcontentloaded');
      log(`cognito ${page.url()}`);
      const fillFirst = async (sels, val, what) => {
        for (const s of sels) {
          const loc = page.locator(s);
          const n = await loc.count().catch(() => 0);
          for (let i = 0; i < n; i++) {
            const el = loc.nth(i);
            if (await el.isVisible().catch(() => false)) {
              await el.fill(val, { timeout: 10000 });
              log(`filled ${what} via ${s} [visible #${i}]`);
              return;
            }
          }
        }
        throw new Error(`Cognito ${what} field (visible) not found`);
      };
      await fillFirst(
        ['#signInFormUsername', 'input[name="username"]', 'input[type="email"]', 'input[autocomplete="username"]'],
        EMAIL,
        'email'
      );
      await fillFirst(
        ['#signInFormPassword', 'input[name="password"]', 'input[type="password"]', 'input[autocomplete="current-password"]'],
        PASSWORD,
        'password'
      );
      const submitLoc = page.locator(
        'input[name="signInSubmitButton"], button[type="submit"], input[type="submit"], [name="signInSubmitButton"]'
      );
      let clicked = false;
      const sn = await submitLoc.count().catch(() => 0);
      for (let i = 0; i < sn; i++) {
        const el = submitLoc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click();
          clicked = true;
          log(`clicked submit [visible #${i}]`);
          break;
        }
      }
      if (!clicked) {
        await page.getByRole('button', { name: /sign in|log in|continue|submit/i }).first().click();
      }

      await page.waitForURL((u) => isAuthedLanding(u) || /\/auth\/callback/.test(u.toString()), {
        timeout: TIMEOUT,
      });
      if (/\/auth\/callback/.test(page.url())) {
        await page.waitForURL((u) => isAuthedLanding(u), { timeout: TIMEOUT }).catch(() => {});
      }
    }

    await page.waitForLoadState('networkidle').catch(() => {});
    const landingPath = pathOf(page.url());
    const loginOk = /\/(dashboard|build)/.test(landingPath);
    log(`login landed ${landingPath} ok=${loginOk}`);
    if (!loginOk) {
      return { loginOk, landingPath, observed: [], verdict: 'login-failed' };
    }

    // ---- observe ----
    const observed = [];
    const observe = async (label, seconds) => {
      const before = consoleHits.length;
      const beforeWs = wsAttempts.length;
      log(`observing ${label} for ${seconds}s…`);
      await page.waitForTimeout(seconds * 1000);
      observed.push({
        page: label,
        seconds,
        hits: consoleHits.slice(before),
        wsAttempts: wsAttempts.slice(beforeWs),
      });
    };

    await observe(landingPath, 30);

    log('navigating to /co-pilot');
    await page.goto('https://qontinui.io/co-pilot', { waitUntil: 'domcontentloaded' }).catch((e) => log(`goto co-pilot: ${e.message}`));
    await page.waitForLoadState('networkidle').catch(() => {});
    await observe('/co-pilot', 45);

    const localFailures = observed.flatMap((o) =>
      o.hits.filter((h) => LOCAL_RUNNER.test(h.text) && (h.type === 'error' || h.type === 'requestfailed' || /failed|404/i.test(h.text)))
    );
    const localWsErrors = observed.flatMap((o) => o.wsAttempts.filter((w) => LOCAL_RUNNER.test(w.url) && w.error));
    const verdict =
      localFailures.length === 0 && localWsErrors.length === 0 ? 'clean' : 'spam-present';

    return { loginOk, landingPath, observed, localFailureCount: localFailures.length + localWsErrors.length, verdict };
  });

  let result;
  let code = 0;
  try {
    await transport.ready();
    result = await transport.dispatch('drive');
    code = result && result.loginOk && result.verdict === 'clean' ? 0 : 1;
  } catch (err) {
    result = { loginOk: false, error: err && err.message ? err.message : String(err) };
    code = 1;
  }

  process.stdout.write(JSON.stringify(result) + '\n');
  await transport.close().catch(() => {});
  process.exit(code);
})();
