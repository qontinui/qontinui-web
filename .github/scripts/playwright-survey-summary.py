#!/usr/bin/env python3
"""Summarise an advisory Playwright run and decide whether the STEP fails.

Used by .github/workflows/cross-browser-survey.yml. The survey's test
pass/fail is advisory: failing tests are reported (step summary table +
`::warning::` annotation) and the step exits 0. What still fails the step is
evidence that the run itself did not happen properly, i.e. infrastructure:

  * no JSON report at all (Playwright crashed before reporting),
  * top-level report errors (globalSetup / webServer failed to start,
    config error),
  * a failing test in the `setup` project (auth seeding broke, so every
    dependent test was skipped and the survey measured nothing),
  * zero survey tests executed, or every executed survey test failed (the
    dev server or backend died mid-run),
  * a non-zero Playwright exit with no failing test to account for it.

Usage: playwright-survey-summary.py <results.json> <browser> <playwright-exit-code>
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ANSI = re.compile(r"\x1b\[[0-9;]*m")
SETUP_PROJECT = "setup"


def md_cell(text: str, limit: int = 200) -> str:
    """Make a string safe for one GitHub-markdown table cell."""
    lines = ANSI.sub("", text).strip().splitlines()
    text = lines[0] if lines else ""
    if len(text) > limit:
        text = text[: limit - 1] + "…"
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return text.replace("|", "\\|").replace("`", "'")


def gh_escape(text: str) -> str:
    """Escape a workflow-command message (`::warning::...`)."""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def walk(suite: dict[str, Any], path: list[str]) -> list[dict[str, Any]]:
    """Flatten the report's nested suites into one row per test execution."""
    rows: list[dict[str, Any]] = []
    title = suite.get("title") or ""
    here = path + [title] if title else path
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            results = test.get("results") or []
            last = results[-1] if results else {}
            error = (last.get("error") or {}).get("message") or ""
            rows.append(
                {
                    "project": test.get("projectName", ""),
                    "status": test.get("status", ""),
                    "file": spec.get("file", ""),
                    "line": spec.get("line", ""),
                    "title": " › ".join(here[1:] + [spec.get("title", "")]),
                    "error": error,
                }
            )
    for child in suite.get("suites", []):
        rows.extend(walk(child, here))
    return rows


def write_summary(lines: list[str]) -> None:
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    text = "\n".join(lines) + "\n"
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)


def infra_fail(browser: str, reason: str) -> int:
    print(f"::error title=Cross-browser survey infrastructure failure ({browser})::{gh_escape(reason)}")
    write_summary(
        [
            f"## Cross-browser survey — {browser}: INFRASTRUCTURE FAILURE",
            "",
            reason,
            "",
            "This is not a survey result: the run itself did not complete, so the job fails.",
        ]
    )
    return 1


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    report_path, browser, raw_exit = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    pw_exit = int(raw_exit) if raw_exit.lstrip("-").isdigit() else -1

    if not report_path.is_file():
        return infra_fail(
            browser,
            f"No Playwright JSON report at {report_path} (playwright exit {pw_exit}); "
            "the run crashed before any reporter wrote.",
        )
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return infra_fail(browser, f"Playwright JSON report is unreadable: {exc}")

    top_errors = report.get("errors") or []
    if top_errors:
        first = md_cell(top_errors[0].get("message", "") or str(top_errors[0]), 400)
        return infra_fail(
            browser,
            f"Playwright reported {len(top_errors)} top-level error(s) "
            f"(globalSetup / webServer / config), first: {first}",
        )

    rows = [r for s in report.get("suites", []) for r in walk(s, [])]
    setup_failed = [r for r in rows if r["project"] == SETUP_PROJECT and r["status"] == "unexpected"]
    if setup_failed:
        return infra_fail(
            browser,
            f"The '{SETUP_PROJECT}' project failed ({md_cell(setup_failed[0]['error'], 400)}); "
            "every dependent survey test was skipped, so nothing was measured.",
        )

    survey = [r for r in rows if r["project"] != SETUP_PROJECT]
    executed = [r for r in survey if r["status"] in ("expected", "unexpected", "flaky")]
    if not executed:
        return infra_fail(browser, f"Zero survey tests executed (playwright exit {pw_exit}).")

    passed = [r for r in survey if r["status"] == "expected"]
    failed = [r for r in survey if r["status"] == "unexpected"]
    flaky = [r for r in survey if r["status"] == "flaky"]
    skipped = [r for r in survey if r["status"] == "skipped"]
    if len(failed) == len(executed):
        # Every executed survey test failed: that is the shape of the dev
        # server or backend dying mid-run, not of browser-specific defects.
        return infra_fail(
            browser,
            f"All {len(executed)} executed survey test(s) failed, first: "
            f"{md_cell(failed[0]['error'], 400)} -- a server dying mid-run, not a survey result.",
        )
    if pw_exit != 0 and not failed:
        return infra_fail(
            browser,
            f"Playwright exited {pw_exit} but the report lists no failing test, "
            "so the exit is not explained by a survey result.",
        )

    lines = [
        f"## Cross-browser survey — {browser} (advisory)",
        "",
        f"passed **{len(passed)}** · failed **{len(failed)}** · "
        f"flaky **{len(flaky)}** · skipped **{len(skipped)}**",
        "",
    ]
    if failed:
        lines += ["| # | Test | Location | First error line |", "|---|---|---|---|"]
        for i, r in enumerate(sorted(failed, key=lambda r: (str(r["file"]), r["line"] or 0)), 1):
            lines.append(
                f"| {i} | {md_cell(r['title'])} | `{md_cell(r['file'])}:{r['line']}` | {md_cell(r['error'])} |"
            )
        lines += [
            "",
            "These failures are advisory and do not fail the job. Full detail is in the "
            "`playwright-report-cross-browser-survey-*` and `cross-browser-survey-test-results-*` artifacts.",
        ]
        print(
            f"::warning title=Cross-browser survey ({browser})::"
            f"{len(failed)} survey test(s) failed on {browser} (advisory; see the job summary and "
            "the Playwright report artifact)."
        )
    else:
        lines.append("All executed survey tests passed.")
    write_summary(lines)
    return 0


if __name__ == "__main__":
    sys.exit(main())
