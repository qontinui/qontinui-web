#!/usr/bin/env bash
# fetch-pinned-binary.sh — obtain a pinned release binary (trivy, zizmor,
# actionlint) for a qontinui-web CI job without depending on the GitHub release
# CDN at job time when the runner already holds it.
#
# Plan: 2026-11-08-ci-tool-binaries-survive-a-github-release-cdn-outage
# (gitleaks is a separate script, fetch-gitleaks.sh, owned by plan
# 2026-11-09-gitleaks-release-cdn-504-reds-prs-and-blocks-the-merge-train; this
# is the same shape for the three other tools).
#
# WHY: on 2026-11-08 the release CDN answered 504 for every asset for over an
# hour while api.github.com stayed 200. The jobs that `curl`ed a tarball (or ran
# setup-trivy, which does the same) failed without ever scanning.
#
# SOURCES, in order. The cache is NOT trusted and NEVER required: a hit is
# copied into this job's private $RUNNER_TEMP and its sha256 is checked THERE,
# so nothing can swap it between check and extract.
#   1. the runner's tool cache
#        ${RUNNER_TOOL_CACHE:-$HOME/.cache}/qontinui-pinned-binary/<tool>/<version>/<sha256>.tar.gz
#      A persistent self-hosted runner downloads each pinned version once.
#   2. the release CDN, with bounded retries. A GitHub-hosted runner starts
#      empty and always lands here. There is deliberately NO actions/cache seed:
#      a restored archive is a tar the scan would have to trust beyond the one
#      checksummed file, and a restore can write over checked-out files before
#      the scan runs (the review of the gitleaks plan rejected it for that
#      reason). So a sustained CDN outage is survived by a WARM self-hosted
#      host and not by a hosted runner; the retries only cover a short blip.
# A verified download fills the cache best-effort (mktemp in the cache dir,
# chmod 0644, then `mv -T`, an atomic rename), so a planted file, a directory at
# the key or an unwritable cache costs a download, never the job. The key
# carries the pinned version AND sha256, so it never serves a version the
# workflow did not ask for, and a tampered entry fails its sha256 and is
# re-downloaded, never extracted.
#
# FAILURE: exit 75 (EX_TEMPFAIL) after one `::error title=<tool> DID NOT RUN`
# annotation that names BOTH sources tried (cache state and the CDN's HTTP
# status or curl exit). It does not write coord's "(not a verdict on this PR)"
# phrase: the step that runs this stays a SETUP row of the job's
# `Declare a setup death` step (declare-setup-death.sh), which is the one writer
# of that phrase, and which refuses to write it for a PR that edits this script.
# Keep this step's name out of coord's INFRA_STEP_PREFIXES ("Set up ", "Cache",
# "Checkout", …) so a failed install is never bypass-landable.
#
# INPUT (env): FPB_TOOL (name, also the cache directory), FPB_VERSION,
#   FPB_SHA256 (of the release asset, from the release's own checksums file),
#   FPB_URL, FPB_MEMBER (the file to extract from the tarball);
#   RUNNER_TEMP, GITHUB_OUTPUT; optional RUNNER_TOOL_CACHE,
#   FPB_VERIFY_ARGS (default "--version"; actionlint wants "-version"),
#   FPB_ADD_TO_PATH=1 (append the binary's directory to $GITHUB_PATH),
#   FPB_MAX_TIME (per-attempt seconds, default 120),
#   FPB_RETRY_MAX_TIME (seconds across retries, default 240).
# OUTPUT: `bin=<path to the binary>` appended to $GITHUB_OUTPUT, only after the
#   binary has run successfully.
set -Eeuo pipefail

tool="${FPB_TOOL:-pinned-binary}"
cdn_status="not attempted"
cache_state="not consulted"

did_not_run() {
  echo "::error title=${tool} DID NOT RUN::${1} Sources tried: host cache ${cache_state}; release CDN ${cdn_status}. THE SCAN DID NOT RUN. This is an infrastructure failure, not a finding; re-run the job."
  exit 75
}
trap 'did_not_run "${tool} fetch failed at: ${BASH_COMMAND}."' ERR
tmp=""
trap 'rm -f -- "$tmp"' EXIT

for v in FPB_TOOL FPB_VERSION FPB_SHA256 FPB_URL FPB_MEMBER RUNNER_TEMP GITHUB_OUTPUT; do
  [[ -n "${!v:-}" ]] || did_not_run "${v} must be set."
done
[[ "$FPB_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || did_not_run "FPB_SHA256 is not a sha256 (${FPB_SHA256})."
[[ "$FPB_TOOL" =~ ^[A-Za-z0-9._-]+$ && "$FPB_VERSION" =~ ^[A-Za-z0-9._-]+$ ]] \
  || did_not_run "FPB_TOOL and FPB_VERSION must be plain names."
[[ "$(uname -m)" == "x86_64" ]] \
  || did_not_run "host arch is $(uname -m), but the pinned ${tool} asset is x86_64 only."

bin="${RUNNER_TEMP}/pinned-bin/${FPB_TOOL}"
tgz="${bin}/${FPB_TOOL}.tar.gz"
cache="${RUNNER_TOOL_CACHE:-${HOME:-/nonexistent}/.cache}/qontinui-pinned-binary/${FPB_TOOL}/${FPB_VERSION}"
hit="${cache}/${FPB_SHA256}.tar.gz"
rm -rf -- "$bin"
mkdir -p "$bin"

verify() { printf '%s  %s\n' "$FPB_SHA256" "$1" | sha256sum -c --status -; }

fill_cache() {
  # 0644: the cache may be shared by runner registrations running as other users.
  if mkdir -p "$cache" 2>/dev/null && tmp="$(mktemp "${cache}/.download.XXXXXX" 2>/dev/null)" \
      && cp -f -- "$tgz" "$tmp" && chmod 0644 "$tmp" && mv -fT -- "$tmp" "$hit" 2>/dev/null; then
    tmp=""
    echo "${tool}: host cache filled (${hit})"
  else
    rm -f -- "$tmp"; tmp=""
    echo "::warning title=${tool} cache not updated::${cache} is unusable, so every run on this runner downloads ${tool}; the scan is unaffected."
  fi
}

cache_hit=0
if [[ -f "$hit" ]]; then
  if cp -f -- "$hit" "$tgz" 2>/dev/null && verify "$tgz"; then
    cache_hit=1
  else
    cache_state="entry present but unreadable or failing its sha256"
    echo "::warning title=${tool} cache entry unusable::${hit} is unreadable or fails its sha256; downloading instead."
  fi
else
  cache_state="miss (${hit})"
fi

if [[ "$cache_hit" -eq 1 ]]; then
  echo "${tool} ${FPB_VERSION}: host-cache hit (${hit}), sha256 verified, no download"
else
  rm -f -- "$tgz"
  rc=0
  code="$(curl --fail --silent --show-error --location \
    --connect-timeout 20 --max-time "${FPB_MAX_TIME:-120}" \
    --retry 3 --retry-delay 5 --retry-max-time "${FPB_RETRY_MAX_TIME:-240}" --retry-all-errors \
    --write-out '%{http_code}' -o "$tgz" "$FPB_URL")" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    cdn_status="failed (HTTP ${code:-none}, curl exit ${rc}, ${FPB_URL})"
    did_not_run "${tool} ${FPB_VERSION} download failed."
  fi
  cdn_status="HTTP ${code:-200}, but the body failed the pin"
  verify "$tgz" || did_not_run "${tool} ${FPB_VERSION} download does not match the pinned sha256 ${FPB_SHA256}."
  cdn_status="ok"
  echo "${tool} ${FPB_VERSION}: downloaded, sha256 verified"
  fill_cache
fi

tar -xzf "$tgz" -C "$bin" "$FPB_MEMBER" 2>/dev/null \
  || did_not_run "the verified ${tool} ${FPB_VERSION} tarball did not extract ${FPB_MEMBER}."
[[ -x "${bin}/${FPB_MEMBER}" ]] || did_not_run "${tool} ${FPB_VERSION} is not executable after extraction."
# shellcheck disable=SC2086  # FPB_VERIFY_ARGS is a word list by design
"${bin}/${FPB_MEMBER}" ${FPB_VERIFY_ARGS:---version} >/dev/null 2>&1 \
  || did_not_run "the extracted ${tool} ${FPB_VERSION} does not run on this host."
rm -f -- "$tgz"
echo "bin=${bin}/${FPB_MEMBER}" >> "$GITHUB_OUTPUT"
if [[ "${FPB_ADD_TO_PATH:-}" == "1" && -n "${GITHUB_PATH:-}" ]]; then
  echo "$bin" >> "$GITHUB_PATH"
fi
