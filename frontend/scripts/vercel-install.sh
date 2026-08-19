#!/usr/bin/env bash
#
# Vercel install step — build the COMPOSED cloud shape, or fail.
#
# `vercel.json`'s `installCommand` replaces Vercel's default install, and this
# script is what both candidate `vercel.json` files invoke (see WHICH
# vercel.json below). It does three things in order:
#
#   1. `npm ci` in frontend/                     — the OSS tree, unchanged
#   2. clone qontinui-cloud-control at a PINNED sha into <repo>/.sibling/
#   3. `npm run cloud:install --source <that>`   — link it into node_modules
#
# and then refuses to exit 0 unless the overlay is actually there. That last
# step is the point of the whole file. A clone failure that fell back to the
# OSS shape would deploy qontinui.io without the org switcher, the beta
# banner, the subscription badge, and with `billingService` /
# `organizationService` as throwing stubs — and would report success. It is
# the same class of defect as the `.catch(() => {})` loader this mechanism
# replaced: wrong, green, and undetectable. Vercel keeps the previous
# deployment serving when a build fails, so failing loud costs no
# availability.
#
# WHICH vercel.json — and why there are two
#
# Vercel reads `vercel.json` from the project's Root Directory, and this repo
# has both a `frontend/` and a `backend/`. Which one the qontinui-web project
# is rooted at is a dashboard setting that is recorded nowhere in the tree,
# and no Vercel credential is available from a dev session to read it. So the
# command is installed in BOTH candidate locations; whichever Vercel reads
# wins and the other is inert. Each passes a different `--config-source`, and
# this script writes it into `public/composed-build.json`, which the
# deployment then serves — so one unauthenticated GET of
# `https://<deployment>/composed-build.json` answers all three questions at
# once: was the build composed, which vercel.json was read, and at which
# cloud-control commit. The inert file is deleted once that answer is in.
#
# See frontend/docs/composed-cloud-build.md.

set -euo pipefail

CONFIG_SOURCE="unknown"
while [ $# -gt 0 ]; do
  case "$1" in
    --config-source)
      CONFIG_SOURCE="${2:?--config-source requires a value}"
      shift 2
      ;;
    *)
      echo "[vercel-install] unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

# Checked here rather than at the point of use: it is interpolated into the
# marker JSON at the very end, and a bad argument must fail before `npm ci`
# and the clone, not after four minutes of them.
if ! printf '%s' "$CONFIG_SOURCE" | grep -qE '^[A-Za-z0-9._-]+$'; then
  echo "[vercel-install] --config-source must match [A-Za-z0-9._-]+; got '$CONFIG_SOURCE'." >&2
  exit 64
fi

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$FRONTEND_DIR/.." && pwd)"
# Mirrors .github/workflows/frontend-ci.yml's `composed-cloud-build` job, which
# checks the sibling out to `.sibling/qontinui-cloud-control` inside the
# workspace and links it from there. Same layout here on purpose: the deploy
# path is then the path CI already proves green on every PR, rather than a
# second arrangement nothing exercises.
SIBLING_DIR="$REPO_DIR/.sibling/qontinui-cloud-control"
OVERLAY_DIR="$FRONTEND_DIR/node_modules/@qontinui/cloud-control"
PIN_FILE="$FRONTEND_DIR/cloud-control.pin"
MARKER_FILE="$FRONTEND_DIR/public/composed-build.json"
REMOTE="https://github.com/qontinui/qontinui-cloud-control.git"

echo "[vercel-install] config source : $CONFIG_SOURCE"
echo "[vercel-install] frontend      : $FRONTEND_DIR"

# ── the pin ─────────────────────────────────────────────────────────────────
# `--depth 1` of a moving `main` would make a qontinui-web deploy able to
# change behaviour with no qontinui-web commit — an untracked input to a
# production build. cloud-control publishes no release tags, so the pin is a
# commit sha in a committed file. Bumping it is a qontinui-web commit and
# rides qontinui-web's review + CI, which is the entire point.
if [ ! -f "$PIN_FILE" ]; then
  echo "[vercel-install] missing $PIN_FILE — cannot resolve the cloud-control pin." >&2
  exit 1
fi
CLOUD_CONTROL_SHA="$(grep -vE '^[[:space:]]*(#|$)' "$PIN_FILE" | head -n 1 | tr -d '[:space:]')"
if ! printf '%s' "$CLOUD_CONTROL_SHA" | grep -qE '^[0-9a-f]{40}$'; then
  echo "[vercel-install] $PIN_FILE must hold a full 40-character commit sha; got '$CLOUD_CONTROL_SHA'." >&2
  exit 1
fi
echo "[vercel-install] cloud-control : $CLOUD_CONTROL_SHA"

# ── the OSS tree, unchanged ─────────────────────────────────────────────────
cd "$FRONTEND_DIR"
npm ci

# ── the sibling, at the pinned sha ──────────────────────────────────────────
rm -rf "$SIBLING_DIR"
mkdir -p "$(dirname "$SIBLING_DIR")"
git init --quiet "$SIBLING_DIR"
git -C "$SIBLING_DIR" remote add origin "$REMOTE"
# GitHub serves fetch-by-sha, so the pin costs one commit's worth of transfer.
# The fallback is for a host that does not: fetch the whole default branch and
# check the sha out of that. Both leave the pinned tree checked out or fail.
if ! git -C "$SIBLING_DIR" fetch --quiet --depth 1 origin "$CLOUD_CONTROL_SHA"; then
  echo "[vercel-install] fetch-by-sha refused; falling back to a full fetch."
  git -C "$SIBLING_DIR" fetch --quiet origin
fi
git -C "$SIBLING_DIR" checkout --quiet "$CLOUD_CONTROL_SHA"

# ── link it in ──────────────────────────────────────────────────────────────
npm run cloud:install -- --source "$SIBLING_DIR"
npm run cloud:status

# ── refuse to ship the OSS shape ────────────────────────────────────────────
if [ ! -f "$OVERLAY_DIR/frontend/src/index.ts" ]; then
  echo "[vercel-install] the overlay is not installed at $OVERLAY_DIR." >&2
  echo "[vercel-install] refusing to continue: this build would silently deploy the OSS shape." >&2
  exit 1
fi

# ── say so, in a file the deployment serves ─────────────────────────────────
# `public/` is copied into the build output, and middleware.ts's matcher
# excludes `*.json`, so this is reachable unauthenticated at
# `/composed-build.json` on any deployment. It is written LAST, only on the
# path where the overlay verified — an OSS build serves a 404 here rather than
# a claim it cannot back.
# `VERCEL_GIT_COMMIT_SHA` is the one value here this script does not
# originate, so it is constrained before interpolation. The marker is a
# machine-read contract (the deployment-shape falsifier), and a value carrying
# a quote or a newline would emit a file that parses as something other than
# what it says — the failure mode this whole change exists to remove,
# reproduced one level down. `--config-source` is checked at parse time above.
WEB_COMMIT_SHA="${VERCEL_GIT_COMMIT_SHA:-}"
if ! printf '%s' "$WEB_COMMIT_SHA" | grep -qE '^[0-9a-fA-F]{0,40}$'; then
  WEB_COMMIT_SHA=""
fi

mkdir -p "$(dirname "$MARKER_FILE")"
cat > "$MARKER_FILE" <<JSON
{
  "composed": true,
  "configSource": "$CONFIG_SOURCE",
  "cloudControlSha": "$CLOUD_CONTROL_SHA",
  "webCommitSha": "$WEB_COMMIT_SHA",
  "generatedBy": "frontend/scripts/vercel-install.sh"
}
JSON
echo "[vercel-install] wrote $MARKER_FILE"
echo "[vercel-install] composed cloud build is active."
