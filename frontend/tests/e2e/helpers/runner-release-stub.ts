import type { Page } from "@playwright/test";

/**
 * Canonical stub for the GitHub-backed release endpoint
 * (`/api/v1/releases/runner/latest`).
 *
 * Download pages resolve their asset lists dynamically from this endpoint;
 * installer labels and the "Recommended" badge are rendered ONLY from real
 * assets. In CI the backend's fetch of api.github.com can hit the 60/hr
 * anonymous rate limit (shared Actions runner IPs) and silently degrade to an
 * empty asset list (`available: false`), so asset-dependent assertions time
 * out — red main runs 29859706423 + 29696362417 both failed this way. Stub
 * the endpoint so the dynamic render is deterministic regardless of GitHub
 * reachability. Windows-only assets are intentional: macOS/Linux then
 * exercise the build-from-source fallback (no prebuilt binaries yet),
 * matching the real release contents.
 */
export const RUNNER_RELEASE_STUB = {
  version: "1.0.0-beta.1",
  tag: "v1.0.0-beta.1",
  name: "Qontinui Runner v1.0.0-beta.1",
  published_at: "2026-06-01T00:00:00Z",
  html_url:
    "https://github.com/qontinui/qontinui-runner/releases/tag/v1.0.0-beta.1",
  prerelease: true,
  available: true,
  reason: null,
  assets: [
    {
      name: "Qontinui.Runner_1.0.0-beta.1_x64_en-US.msi",
      url: "https://example.test/runner.msi",
      size: 12_000_000,
      content_type: "application/octet-stream",
      platform: "windows",
      kind: "msi",
      arch: "x64",
    },
    {
      name: "Qontinui.Runner_1.0.0-beta.1_x64-setup.exe",
      url: "https://example.test/runner-setup.exe",
      size: 11_000_000,
      content_type: "application/octet-stream",
      platform: "windows",
      kind: "exe",
      arch: "x64",
    },
  ],
};

/** Route the release endpoint to the stub for every request on this page. */
export async function stubRunnerRelease(page: Page): Promise<void> {
  await page.route("**/api/v1/releases/runner/latest", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(RUNNER_RELEASE_STUB),
    })
  );
}
