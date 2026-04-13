/**
 * Centralized test credentials for E2E tests.
 *
 * IMPORTANT: These must match the credentials in:
 * - qontinui-web/backend/app/core/test_credentials.py (source of truth)
 * - qontinui-web/frontend/.env.local (NEXT_PUBLIC_DEV_EMAIL, NEXT_PUBLIC_DEV_PASSWORD)
 * - qontinui-runner/.env (VITE_DEV_EMAIL, VITE_DEV_PASSWORD)
 *
 * When changing credentials, update ALL locations and run
 * reset_local_password.py to update the database.
 */

// Standard development password - same for all dev users
export const STANDARD_DEV_PASSWORD = "dev123";

// Primary development user - used for all local development
export const DEV_USER = {
  email: "josh@qontinui.io",
  username: "josh",
  password: STANDARD_DEV_PASSWORD,
  isSuperuser: true,
} as const;

// Export for backward compatibility with existing tests
export const TEST_USER = DEV_USER;
