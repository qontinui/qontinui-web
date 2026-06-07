#!/usr/bin/env node
/**
 * login-churn-probe.cjs — no-creds probe for the 2026-06-07 /login
 * navigation-churn regression: load qontinui.io/login in a fresh
 * headless context and count full navigations + key console lines
 * over 30s. A healthy login page navigates once.
 */
const { createTransport } = require('@qontinui/ui-bridge-wrapper');

(async () => {
  const transport = createTransport({
    kind: 'injected',
    options: { targetUrl: 'https://qontinui.io/login', waitForSettle: false, readyTimeoutMs: 45000, headed: false },
  });

  transport.register('drive', async (_p, ctx) => {
    const page = ctx.page;
    let navs = 0;
    const consoleCounts = {};
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) navs++;
    });
    page.on('console', (msg) => {
      const t = msg.text();
      const key = /attempting token refresh/.test(t)
        ? 'refresh-attempt'
        : /halting \(redirecting to re-auth\)|treating as session expiry/.test(t)
          ? 'halt-redirect'
          : /401/.test(t)
            ? '401'
            : /redirect/i.test(t)
              ? 'other-redirect'
              : null;
      if (key) consoleCounts[key] = (consoleCounts[key] || 0) + 1;
    });
    await page.waitForTimeout(30000);
    // Is the form even present/stable at the end?
    const emailBtnVisible = await page
      .getByText(/continue with email/i)
      .first()
      .isVisible()
      .catch(() => false);
    return { url: page.url(), navsIn30s: navs, consoleCounts, emailBtnVisible };
  });

  let result;
  try {
    await transport.ready();
    result = await transport.dispatch('drive');
  } catch (err) {
    result = { error: err && err.message ? String(err.message).slice(0, 300) : String(err) };
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  await transport.close().catch(() => {});
  process.exit(0);
})();
