# Frontend E2E Integration Tests

Playwright-based end-to-end tests for the integration testing workflow.

## Overview

This test suite validates the complete user workflow for integration testing in the browser:

- Page navigation and UI display
- Process and snapshot selection
- Smart recommendations
- Execution and visualization
- Timeline playback
- Coverage panel
- PDF and video export
- Error handling
- Manual selection mode

## Test Structure

```
tests/e2e/
├── fixtures.ts                    # Custom Playwright fixtures
├── global-setup.ts                # Global test setup
├── global-teardown.ts             # Global test teardown
├── integration-testing.spec.ts    # Main E2E test suite
└── README.md                      # This file
```

## Test Suites

### 1. Integration Testing - Complete Workflow

Tests the full happy path user workflow:

- ✅ Display integration testing page with all sections
- ✅ Select process from dropdown
- ✅ View and apply smart recommendations
- ✅ Manually select snapshots
- ✅ Execute process and display results
- ✅ Play execution timeline
- ✅ Display coverage panel
- ✅ Export execution to PDF
- ✅ Export execution to video

### 2. Integration Testing - Manual Selection Mode

Tests manual snapshot selection:

- ✅ Switch to manual selection mode
- ✅ Select multiple snapshots manually

### 3. Integration Testing - Error States

Tests error handling:

- ✅ Handle execution failure gracefully
- ✅ Handle network errors
- ✅ Handle missing snapshots error

### 4. Integration Testing - Visualization

Tests visualization features:

- ✅ Display action visualizations for all action types
- ✅ Navigate through timeline steps
- ✅ Display action details on selection

## Running Tests

### Prerequisites

```bash
cd frontend
npm install
npx playwright install --with-deps
```

### Basic Usage

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test tests/e2e/integration-testing.spec.ts

# Run specific test
npx playwright test -g "should export execution to PDF"
```

### Interactive Testing

```bash
# Run with UI mode (interactive)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run in debug mode
npm run test:e2e:debug
```

### Browser-Specific

```bash
# Run on Chromium
npm run test:e2e:chromium

# Run on Firefox
npm run test:e2e:firefox

# Run on WebKit (Safari)
npm run test:e2e:webkit
```

### View Results

```bash
# View HTML report
npm run test:e2e:report

# Or manually
npx playwright show-report
```

## Configuration

### playwright.config.ts

Key configuration:
- Base URL: `http://localhost:3001`
- Browsers: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari
- Timeout: 30 seconds per test
- Retries: 2 in CI, 0 locally
- Parallel execution: Yes (unless CI)
- Reporters: HTML, JSON, JUnit, List
- Traces: On first retry
- Screenshots: On failure
- Videos: Retain on failure

### Environment Variables

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3001  # Base URL for tests
CI=true                                     # Enable CI mode
```

## Custom Fixtures

### authenticatedPage

Provides a page that's already logged in:

```typescript
test('my test', async ({ authenticatedPage }) => {
  // Use authenticatedPage instead of page
  await authenticatedPage.goto('/integration-testing');
});
```

### mockSnapshotData

Provides mock snapshot data for tests:

```typescript
test('my test', async ({ mockSnapshotData }) => {
  // Use mockSnapshotData in test
  console.log(mockSnapshotData.run_id);
});
```

## Writing New Tests

### Template

```typescript
test.describe('New Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/integration-testing');
    await page.waitForLoadState('networkidle');

    // Setup mock API responses
    await page.route('**/api/endpoint', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ /* mock data */ }),
      });
    });
  });

  test('should perform new action', async ({ page }) => {
    // Arrange
    const button = page.locator('[data-testid="new-button"]');

    // Act
    await button.click();

    // Assert
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

### Best Practices

1. **Use data-testid attributes** for reliable selectors
   ```typescript
   const element = page.locator('[data-testid="my-element"]');
   ```

2. **Wait for network idle before assertions**
   ```typescript
   await page.waitForLoadState('networkidle');
   ```

3. **Use explicit waits for dynamic content**
   ```typescript
   await expect(element).toBeVisible({ timeout: 10000 });
   ```

4. **Mock API responses for predictable tests**
   ```typescript
   await page.route('**/api/**', async (route) => {
     await route.fulfill({ /* mock response */ });
   });
   ```

5. **Use flexible selectors with fallbacks**
   ```typescript
   const element = page.locator('text=Submit').or(page.locator('button[type="submit"]'));
   ```

6. **Clean up after tests**
   ```typescript
   test.afterEach(async ({ page }) => {
     // Cleanup logic
   });
   ```

7. **Test error states**
   ```typescript
   await page.route('**/api/**', route => route.abort('failed'));
   await expect(page.locator('[role="alert"]')).toBeVisible();
   ```

## Test Coverage

### User Workflows Covered

- ✅ Complete workflow (100%)
- ✅ Manual selection (100%)
- ✅ Error scenarios (100%)
- ✅ Visualization features (90%+)
- ✅ Export functionality (100%)

### Action Types Tested

- ✅ FIND
- ✅ CLICK
- ✅ TYPE
- ✅ SCROLL
- ✅ WAIT
- ✅ All visualization components

### Error Cases Tested

- ✅ Execution failure
- ✅ Network errors
- ✅ Missing data validation
- ✅ Partial success handling

## Debugging

### Debug Mode

```bash
# Run with Playwright Inspector
npx playwright test --debug

# Run specific test in debug mode
npx playwright test --debug -g "test name"
```

### Headed Mode

```bash
# See browser actions
npx playwright test --headed

# Slow down execution
npx playwright test --headed --slowMo=1000
```

### Trace Viewer

```bash
# Generate traces
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip
```

### Screenshots

Screenshots are automatically captured on failure in `test-results/`.

### Videos

Videos are automatically recorded on failure in `test-results/`.

## Continuous Integration

Tests run in GitHub Actions on:
- Pull requests
- Pushes to main/develop
- Manual workflow dispatch

Configuration: `.github/workflows/e2e-tests.yml`

### CI Features

- Runs on Ubuntu latest
- Tests Chromium only in CI (for speed)
- Retries failed tests twice
- Uploads artifacts (reports, screenshots, videos)
- Generates test summary

## Troubleshooting

### Common Issues

**Playwright not installed**
```bash
npx playwright install --with-deps
```

**Tests fail on CI but pass locally**
```bash
# Run with CI environment variable
CI=true npm run test:e2e
```

**Element not found**
```typescript
// Add explicit wait
await page.waitForSelector('[data-testid="element"]');
```

**Flaky tests**
```typescript
// Use Playwright's auto-wait
await expect(element).toBeVisible({ timeout: 10000 });

// Or run with retries
npx playwright test --retries=2
```

**Timeout errors**
```typescript
// Increase timeout for specific action
await page.waitForSelector('[data-testid="element"]', { timeout: 30000 });

// Or in config (playwright.config.ts)
timeout: 60 * 1000
```

### Debug Checklist

1. ✅ Check test output for error messages
2. ✅ View screenshots in test-results/
3. ✅ Watch video recordings of failures
4. ✅ Run with --headed to see browser
5. ✅ Use --debug for step-by-step execution
6. ✅ Check network tab in trace viewer
7. ✅ Verify API mocks are working

## Performance

### Test Execution Times

- Single test: ~5-10 seconds
- Full suite: ~2-3 minutes (parallel)
- CI execution: ~5-7 minutes (with setup)

### Optimization Tips

1. Run in parallel (default in Playwright)
2. Use test.describe.configure({ mode: 'parallel' })
3. Mock API responses instead of real calls
4. Skip slow tests during development
5. Use headed mode only when debugging

## Test Statistics

- **Total Test Suites**: 4
- **Total Tests**: 15+
- **Average Execution Time**: 2-3 minutes
- **Browsers Tested**: 5 (Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari)
- **Coverage**: 90%+ of critical user paths

## Related Documentation

- [Full E2E Testing Guide](../../docs/E2E_TESTING.md)
- [Quick Start Guide](../../docs/E2E_TESTING_QUICK_START.md)
- [Backend E2E Tests](../../backend/tests/README.md)
- [Playwright Documentation](https://playwright.dev)

## Support

For issues or questions:
1. Check test output and error messages
2. View screenshots and videos in test-results/
3. Use Playwright trace viewer for detailed debugging
4. Run tests with --debug flag
5. Check CI/CD artifacts for detailed results
