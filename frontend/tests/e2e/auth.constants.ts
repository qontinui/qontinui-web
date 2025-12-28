/**
 * Authentication constants for Playwright tests
 *
 * This file is kept separate from auth.setup.ts to avoid importing test() calls
 * into the playwright config file.
 */

// Path where the authenticated storage state is saved
// This is relative to the frontend directory
export const STORAGE_STATE_PATH = "tests/e2e/.auth/user.json";
