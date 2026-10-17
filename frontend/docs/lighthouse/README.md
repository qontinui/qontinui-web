# Lighthouse: marketing pages

Plan `2026-10-09-qontinui-marketing-studio-animated-process-explainers`, Phase 4.
Phase 4 replaces the landing hero with an animated scene embed and adds
`/how-it-works`. Its acceptance test is that Lighthouse performance is not
worse than the baseline measured **before** the embeds.

| File | What it is |
| --- | --- |
| `marketing-baseline.json` | `/` at qontinui-web `3f872b95e`, before the scene embeds |
| `marketing-after-embeds.json` | `/` and `/how-it-works` with the embeds (written by the PR that adds them) |

The baseline has no `/how-it-works` entry. That route did not exist then: a
production build answered it with `307`. The page is new, so its first
measurement is its own baseline.

## Method (reproducible)

```bash
cd frontend
npm ci && npm run build
npx next start -p 3101 -H 127.0.0.1 &
CHROME_PATH=<chrome or chromium binary> node scripts/lighthouse-marketing.mjs \
  --base http://127.0.0.1:3101 --label "<label>" --out docs/lighthouse/<name>.json \
  --runs 5 --path / --path /how-it-works
```

- **Production build only**, never `next dev`.
- **Lighthouse is pinned** (`lighthouse@13.5.0`, run through `npx`) in the
  script. The summary records the Lighthouse version, the Chrome user agent and
  the commit measured.
- **Two form factors per path.** Mobile is Lighthouse's default throttled
  profile. Desktop is `--preset=desktop`.
- **5 runs per form factor**, each in a fresh headless Chrome. The summary keeps
  the **median** of every metric and lists every run's performance score.
- The full JSON reports go to `<name>.json.reports/`, which is git-ignored.

The baseline was measured on a shared Linux development box (Debian 13,
Playwright's Chromium) that was also running other work. Mobile performance on
that box varied by about ±7 points between runs of the same build: two sessions
gave medians of 76 and 70. So "not regressed" is judged on medians measured **in
one session, against the same box, alternating the baseline build and the new
build**, not by comparing to a number taken on a different day. The PR that adds
`marketing-after-embeds.json` records how it did this.
