/**
 * Centralized test credentials for E2E tests.
 *
 * The actual values live in ONE place — `qontinui-web/dev-credentials.json`
 * (the repo-root single source of truth) — and are read at module load
 * below. The same JSON is read by the Python side
 * (`backend/app/core/test_credentials.py`), so the two cannot drift.
 *
 * This module is imported only by Playwright E2E tests (it runs in Node,
 * never bundled into the Next app), so a synchronous fs read is safe.
 *
 * To change the dev password, edit `dev-credentials.json` and run
 * `backend/reset_local_password.py` to update the local database.
 * Do NOT hardcode a literal here — the drift guard
 * (`scripts/check_dev_credentials_drift.py`) fails CI if you do.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// frontend/tests/e2e/test-credentials.ts → repo root is three levels up.
const CREDENTIALS_PATH = resolve(__dirname, "../../../dev-credentials.json");

interface DevCredentials {
  email: string;
  username: string;
  password: string;
  is_superuser: boolean;
  is_verified: boolean;
}

const creds = JSON.parse(
  readFileSync(CREDENTIALS_PATH, "utf-8")
) as DevCredentials;

// Standard development password - same for all dev users
export const STANDARD_DEV_PASSWORD = creds.password;

// Primary development user - used for all local development
export const DEV_USER = {
  email: creds.email,
  username: creds.username,
  password: creds.password,
  isSuperuser: creds.is_superuser,
} as const;

// Export for backward compatibility with existing tests
export const TEST_USER = DEV_USER;
