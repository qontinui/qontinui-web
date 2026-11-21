#!/usr/bin/env bash
# VENDORED from qontinui-claude-config@910fa7078 scripts/install-pwsh-linux.sh for
# .github/actions/ensure-pwsh. Byte-identical below this note; re-vendor rather than edit.
# install-pwsh-linux.sh - Install PowerShell 7 on a Linux fleet box, user-space, no root.
#
# Plan: 2026-09-02-fleet-tooling-silently-noops-on-a-linux-box (Phase 2).
#
# WHY THIS EXISTS. The fleet carries tracked .ps1 and .psm1 files (counts: the
# Summary table of knowledge-base/qontinui-specific/powershell-corpus.md), and on
# a Linux box with no PowerShell every one of them is inoperative -- four
# registered SessionStart hooks exit 0 silently, the selftests cannot run,
# and the cargo stale-target sweep has no interpreter.
# `apt install powershell` needs root and a Microsoft apt repo; a fleet box's
# agent session has neither. Microsoft's Linux tarball needs neither: it runs
# from any directory. This script is the one-command, checkable version of that
# install, so the next Linux box does not repeat it by hand.
#
# WHAT IT DOES
#   1. Downloads powershell-<version>-linux-<arch>.tar.gz from the GitHub release
#      (or takes a local --tarball), and VERIFIES it against the release's
#      published hashes.sha256. A tarball that cannot be verified is refused.
#   2. Extracts it to $QONTINUI_PWSH_PREFIX (default ~/.local/share/powershell/7)
#      and writes a marker file there recording version + sha256 + install time.
#   3. Writes ~/.local/bin/pwsh, a two-line sh wrapper that execs the extracted
#      binary. ~/.local/bin is on PATH for interactive shells on Debian; the
#      fleet's capability doctor and the PowerShell resolver also probe
#      ~/.local/bin/pwsh explicitly, so a session whose PATH lacks it still finds
#      it.
#
# GLOBALIZATION. .NET on Linux needs libicu, or DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1.
# Measured 2026-09-02 on merytshost (Debian 13): libicu 76 IS installed
# (/usr/lib/x86_64-linux-gnu/libicuuc.so.76) and .NET 10 finds it by probing
# versioned sonames, so `ldconfig -p` listing no libicu is NOT evidence of its
# absence, and the invariant flag is NOT set here. --check reports which mode
# the installed pwsh actually runs in; if a box genuinely lacks ICU, pwsh fails
# at startup with a clear "Couldn't find a valid ICU package" message, and the
# operator's choice is `apt install libicu76` (root) or exporting the invariant
# flag in the wrapper -- a culture-behaviour change this script does not make
# on its own.
#
# CONTRACT (same shape as install-guard-hooks.sh / install-cargo-sweep.ps1):
#   install-pwsh-linux.sh                 install (idempotent: same version -> "unchanged")
#   install-pwsh-linux.sh --check         report installed version + wrapper state; exit 1 if absent
#   install-pwsh-linux.sh --uninstall     remove exactly what this script installed; exit 0 either way
#   install-pwsh-linux.sh --dry-run       print what would happen, touch nothing
#   install-pwsh-linux.sh --version 7.6.5 pin a release (default: the GitHub "latest")
#   install-pwsh-linux.sh --tarball PATH  use a local tarball instead of downloading (still verified)
#   install-pwsh-linux.sh -h | --help     this header
#
# Never runs sudo. Never touches /usr, /opt or /etc. Exit 2 on a refusal
# (unsupported OS/arch, unverifiable tarball, download failure).

set -euo pipefail

PREFIX="${QONTINUI_PWSH_PREFIX:-$HOME/.local/share/powershell/7}"
WRAPPER="${QONTINUI_PWSH_WRAPPER:-$HOME/.local/bin/pwsh}"
MARKER="$PREFIX/.installed-by-install-pwsh-linux"
RELEASE_API="https://api.github.com/repos/PowerShell/PowerShell/releases"
RELEASE_DL="https://github.com/PowerShell/PowerShell/releases/download"

mode=install
version=""
tarball=""

usage() { sed -n '2,49p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
    case "$1" in
        --check) mode=check ;;
        --uninstall) mode=uninstall ;;
        --dry-run) mode=dryrun ;;
        --version) shift; version="${1:-}"; [ -n "$version" ] || { echo "install-pwsh-linux: --version needs a value" >&2; exit 2; } ;;
        --version=*) version="${1#--version=}" ;;
        --tarball) shift; tarball="${1:-}"; [ -n "$tarball" ] || { echo "install-pwsh-linux: --tarball needs a path" >&2; exit 2; } ;;
        --tarball=*) tarball="${1#--tarball=}" ;;
        -h|--help) usage; exit 0 ;;
        *) echo "install-pwsh-linux: unknown argument '$1' (see --help)" >&2; exit 2 ;;
    esac
    shift
done

say() { printf 'install-pwsh-linux: %s\n' "$*"; }
die() { printf 'install-pwsh-linux: %s\n' "$*" >&2; exit 2; }

installed_version() {
    # The version the wrapper actually runs, or "" when it does not run.
    [ -x "$WRAPPER" ] || return 0
    "$WRAPPER" -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()' 2>/dev/null | tr -d '\r' | tail -1 || true
}

wrapper_target_ok() {
    # True iff the wrapper is OURS: it names $PREFIX/pwsh.
    [ -f "$WRAPPER" ] && grep -q -F "$PREFIX/pwsh" "$WRAPPER"
}

globalization_mode() {
    [ -x "$WRAPPER" ] || return 0
    "$WRAPPER" -NoProfile -NonInteractive -Command \
        'if ([System.AppContext]::GetData("System.Globalization.Invariant") -eq $true) { "invariant" } else { "icu (" + [System.Globalization.CultureInfo]::CurrentCulture.Name + ")" }' \
        2>/dev/null | tr -d '\r' | tail -1 || true
}

do_check() {
    local v marker_v="" rc=0
    if [ -f "$MARKER" ]; then marker_v="$(sed -n 's/^version=//p' "$MARKER" | head -1)"; fi
    v="$(installed_version)"
    printf '%-10s %s\n' "prefix"  "$PREFIX $([ -d "$PREFIX" ] && echo present || echo ABSENT)"
    printf '%-10s %s\n' "marker"  "${marker_v:-ABSENT}"
    if [ -x "$WRAPPER" ]; then
        printf '%-10s %s (%s)\n' "wrapper" "$WRAPPER" "$(wrapper_target_ok && echo "ours -> $PREFIX/pwsh" || echo "NOT ours -- points elsewhere")"
    else
        printf '%-10s %s\n' "wrapper" "$WRAPPER ABSENT"; rc=1
    fi
    if [ -n "$v" ]; then
        printf '%-10s %s\n' "runs"   "pwsh $v, globalization: $(globalization_mode)"
    else
        printf '%-10s %s\n' "runs"   "NO -- the wrapper does not execute (missing binary, or ICU/glibc failure)"; rc=1
    fi
    if [ -n "$marker_v" ] && [ -n "$v" ] && [ "$marker_v" != "$v" ]; then
        printf '%-10s %s\n' "drift"  "marker says $marker_v but the wrapper runs $v"; rc=1
    fi
    if command -v pwsh >/dev/null 2>&1; then
        printf '%-10s %s\n' "on PATH" "$(command -v pwsh)"
    else
        printf '%-10s %s\n' "on PATH" "no (add ~/.local/bin to PATH; the doctor and resolver probe $WRAPPER directly)"
    fi
    [ $rc -eq 0 ] && say "OK" || say "NOT installed (or drifted) -- run without flags to install"
    return $rc
}

do_uninstall() {
    local removed=0
    if wrapper_target_ok; then rm -f "$WRAPPER"; say "removed $WRAPPER"; removed=1
    elif [ -e "$WRAPPER" ]; then say "left $WRAPPER alone: it is not the wrapper this script wrote"; fi
    if [ -f "$MARKER" ]; then rm -rf "$PREFIX"; say "removed $PREFIX"; removed=1
    elif [ -d "$PREFIX" ]; then say "left $PREFIX alone: no marker, so this script did not install it"; fi
    [ $removed -eq 1 ] || say "nothing to remove"
    exit 0
}

case "$mode" in
    check) do_check; exit $? ;;
    uninstall) do_uninstall ;;
esac

# ---- install / dry-run --------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || die "refusing: this installs the LINUX tarball and $(uname -s) is not Linux"
case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "refusing: no PowerShell tarball for arch $(uname -m)" ;;
esac
command -v curl >/dev/null 2>&1 || die "refusing: curl is required"
command -v sha256sum >/dev/null 2>&1 || die "refusing: sha256sum is required"

if [ -z "$version" ]; then
    version="$(curl -fsS --max-time 30 "$RELEASE_API/latest" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)" \
        || die "could not resolve the latest release from $RELEASE_API/latest"
    [ -n "$version" ] || die "could not parse a tag_name from $RELEASE_API/latest"
fi
version="${version#v}"
asset="powershell-${version}-linux-${arch}.tar.gz"

current="$(installed_version)"
if [ "$mode" = "install" ] && [ "$current" = "$version" ] && wrapper_target_ok && [ -f "$MARKER" ]; then
    say "unchanged: pwsh $version already installed at $PREFIX with wrapper $WRAPPER"
    exit 0
fi

if [ "$mode" = "dryrun" ]; then
    say "would install pwsh $version ($asset) to $PREFIX, write $WRAPPER, verify against $RELEASE_DL/v$version/hashes.sha256"
    [ -n "$current" ] && say "currently installed: $current"
    exit 0
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/install-pwsh-linux.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [ -n "$tarball" ]; then
    [ -f "$tarball" ] || die "--tarball $tarball does not exist"
    cp "$tarball" "$work/$asset"
else
    say "downloading $asset"
    curl -fsSL --max-time 600 -o "$work/$asset" "$RELEASE_DL/v$version/$asset" || die "download failed: $RELEASE_DL/v$version/$asset"  # msys-path-ok: Linux-only installer, refuses non-Linux hosts above
fi

say "verifying $asset against the release's hashes.sha256"
curl -fsSL --max-time 60 -o "$work/hashes.sha256" "$RELEASE_DL/v$version/hashes.sha256" || die "could not fetch hashes.sha256 for v$version -- refusing to install an unverified tarball"  # msys-path-ok: Linux-only installer, refuses non-Linux hosts above
# The published hashes.sha256 is UTF-16LE with a BOM and CRLF line endings
# (measured v7.6.5, 2026-09-02) -- a byte grep for the asset name matches
# nothing in it. Normalize to UTF-8/LF before reading it; a file without the
# BOM is passed through as-is.
if head -c 2 "$work/hashes.sha256" | od -An -tx1 | grep -q 'ff fe'; then
    iconv -f UTF-16LE -t UTF-8 "$work/hashes.sha256" | tr -d '\r' > "$work/hashes.txt"
else
    tr -d '\r' < "$work/hashes.sha256" > "$work/hashes.txt"
fi
expected="$(grep -F -- "$asset" "$work/hashes.txt" | awk '{print $1}' | head -1 || true)"
[ -n "$expected" ] || die "hashes.sha256 for v$version has no line for $asset -- refusing"
actual="$(sha256sum "$work/$asset" | awk '{print $1}')"
[ "$actual" = "$expected" ] || die "sha256 mismatch for $asset: expected $expected, got $actual -- refusing"

say "extracting to $PREFIX"
mkdir -p "$(dirname "$PREFIX")" "$(dirname "$WRAPPER")"
stage="$work/stage"; mkdir -p "$stage"
tar -xzf "$work/$asset" -C "$stage"
[ -f "$stage/pwsh" ] || die "tarball did not contain pwsh at its root"
chmod +x "$stage/pwsh"
rm -rf "$PREFIX"
mv "$stage" "$PREFIX"
{
    echo "version=$version"
    echo "sha256=$actual"
    echo "asset=$asset"
    echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "installed_by=install-pwsh-linux.sh"
} > "$MARKER"

cat > "$WRAPPER" <<EOF
#!/bin/sh
# Written by qontinui-claude-config/scripts/install-pwsh-linux.sh -- do not edit; re-run the installer.
exec "$PREFIX/pwsh" "\$@"
EOF
chmod +x "$WRAPPER"

v="$(installed_version)"
[ -n "$v" ] || die "installed, but $WRAPPER does not run. On a box with no libicu, .NET prints 'Couldn't find a valid ICU package'; the fix is 'apt install libicu<NN>' (root) or exporting DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 in $WRAPPER (changes culture-sensitive behaviour)"
say "installed pwsh $v at $PREFIX; wrapper $WRAPPER; globalization: $(globalization_mode)"
command -v pwsh >/dev/null 2>&1 || say "note: ~/.local/bin is not on this shell's PATH; hooks and the doctor probe $WRAPPER directly"
