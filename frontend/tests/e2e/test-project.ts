/**
 * Single source of truth for the seeded E2E test project.
 *
 * The backend seed (`backend/tests/utils/seed_test_project.py`)
 * creates `project.projects` row with this exact UUID before the
 * Playwright run, owned by the dev test user. Specs that need a
 * project to be "selected" pass it as `?project=<TEST_PROJECT_ID>`
 * — `RequireProject` accepts a URL query param as proof of
 * selection (`src/components/require-project.tsx:37`).
 *
 * Keep in sync with `TEST_PROJECT_ID` in
 * `backend/tests/utils/seed_test_project.py`.
 */
export const TEST_PROJECT_ID = "fb93478d-98bd-4e40-99f4-0f2c08c1fd5a";
