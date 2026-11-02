# Lighthouse: marketing pages

Plan `2026-10-09-qontinui-marketing-studio-animated-process-explainers`, Phase 4.
Phase 4 replaces the landing hero with an animated scene embed and adds
`/how-it-works`. Its acceptance test is that Lighthouse performance is not
worse than the baseline measured **before** the embeds.

| File                                  | What it is                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `marketing-baseline.json`             | `/` at qontinui-web `3f872b95e`, before the scene embeds                                                       |
| `marketing-after-embeds.json`         | `/` and `/how-it-works` with the embeds                                                                        |
| `marketing-baseline-rerun-{1,2}.json` | the baseline build, re-measured immediately before and after `marketing-after-embeds.json` in the same session |

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

## Result: not regressed (2026-10-17)

The baseline build of `3f872b95e` and the embed build were measured in one
session, in the order baseline, after, baseline. Both came from
`npm run build`. The embed build was served by `next start` on `:3101`. The
baseline build was rebuilt over by then, so a copy of it was taken first: its
`.next/standalone` with `.next/static` and `public/` beside it. That copy was
served by its own `node server.js` on `:3102`. This is the same Next server
`next start` runs for an `output: 'standalone'` build, serving the same files,
and the baseline's byte weight matches the first baseline exactly
(669,512 B). Each figure is a median of 5
runs. All three files record `commit: d55530a41`. That is wrong for every one of
them, so do not use the field to reproduce these measurements. The script
reads `git rev-parse HEAD` in the measuring checkout, and that checkout's HEAD
was the baseline commit of this branch before it was rebased. The rebase
rewrote that commit as `a47c6a3fe`, so `d55530a41` is on no branch. The builds
actually measured were:

- the reruns: `3f872b95e`;
- `marketing-after-embeds.json`: the embed commit's working tree before it was
  committed. That tree differs from the committed one only in `data-testid`
  attributes, in copy and comments, and in test and spec files.

| `/`               | performance (mobile / desktop) | LCP ms (mobile) | TBT ms (mobile / desktop) | CLS (mobile) | bytes (mobile) |
| ----------------- | ------------------------------ | --------------- | ------------------------- | ------------ | -------------- |
| baseline, rerun 1 | 76 / 98                        | 3911            | 430 / 2                   | 0.0038       | 669,512        |
| **with embeds**   | **75 / 98**                    | 4000            | 529 / 83                  | 0.0040       | 687,900        |
| baseline, rerun 2 | 73 / 98                        | 4738            | 441 / 61                  | 0.0038       | 669,512        |

`/how-it-works` is new, so this measurement is its baseline: **76 / 98**
(mobile / desktop), LCP 3925 ms, TBT 488 / 69 ms, CLS 0.

The `/` score falls between the two baseline reruns. Mobile TBT is about
90 ms higher. That is the page's own extra JavaScript, about 3 kB of
first-load JS (213 kB to 216 kB); it was not broken down further. The
player and Remotion are not part of the load. The player chunk is requested
only after the visitor's first interaction, on idle, so a Lighthouse run never
fetches it.

That gate was added after a first attempt failed. The first attempt loaded
the player on idle as soon as the hero was visible, and it measured 65 on
mobile with TBT 642 ms, against 72 for the baseline in the same session.
