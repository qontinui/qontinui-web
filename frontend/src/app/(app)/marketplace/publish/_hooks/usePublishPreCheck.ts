import { useState } from "react";

/**
 * The publish page's local pre-check: a text search for `eval(` / `exec(` in
 * the code about to be published. It is NOT the security scan — that runs on
 * the server when a version is published (`publish_version`), and only its
 * result is ever shown as a scan verdict.
 *
 * - `clean`: neither pattern is in the code that was checked.
 * - `flagged`: one of them is.
 * - `null`: not run yet, or the code changed since it ran.
 */
export type PreCheckResult = "clean" | "flagged" | null;

const FLAGGED_PATTERNS = ["eval(", "exec("];

export function usePublishPreCheck(code: string) {
  const [checkedCode, setCheckedCode] = useState<string | null>(null);

  const result: PreCheckResult =
    checkedCode === null || checkedCode !== code
      ? null
      : FLAGGED_PATTERNS.some((p) => checkedCode.includes(p))
        ? "flagged"
        : "clean";

  const runPreCheck = () => setCheckedCode(code);

  return { preCheckResult: result, runPreCheck };
}
