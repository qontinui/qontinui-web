# Test Setup Guide

This document describes the test infrastructure for qontinui-web frontend.

## Test Framework

We use **Vitest** for unit and integration tests, and **Playwright** for end-to-end tests.

- **Unit/Integration Tests**: Vitest + React Testing Library
- **E2E Tests**: Playwright

## Installation

Install the required dependencies:

```bash
npm install --save-dev vitest @vitejs/plugin-react jsdom
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install --save-dev @vitest/ui @vitest/coverage-v8
```

Or use the provided script (after creating it):

```bash
npm run test:setup
```

## Running Tests

### Unit/Integration Tests

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests with UI
npm run test:ui

# Run specific test file
npm test src/components/expectations/ExpectationsPanel.test.tsx
```

### E2E Tests (Playwright)

```bash
# Run all E2E tests
npm run test:e2e

# Run E2E tests in UI mode
npm run test:e2e:ui

# Run specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:webkit
```

## Test Files Created

### Expectations Components

1. **ExpectationsPanel.test.tsx**
   - Tab rendering and navigation
   - Integration with all child editors
   - Checkpoint and state management
   - Empty state handling

2. **GlobalExpectationsEditor.test.tsx**
   - Error detection toggles (console/network errors)
   - Timing limits (action/total duration)
   - Pattern matching configuration
   - Confidence threshold slider
   - Field preservation across updates

3. **SuccessCriteriaEditor.test.tsx**
   - All criteria types (all_actions_pass, min_matches, max_failures, checkpoint_passed, required_states, custom)
   - Type-specific field validation
   - State management (add/remove states)
   - Checkpoint selection (dropdown vs text input)
   - Custom Python expressions
   - Description field for all types

4. **CheckpointListEditor.test.tsx**
   - Adding/removing checkpoints
   - Expanding/collapsing checkpoints
   - Editing checkpoint properties (description, screenshot, timing)
   - Claude review instructions (add/edit/remove)
   - Badge display (Screenshot, Claude Review)
   - Multiple checkpoint handling

5. **ActionExpectationsEditor.test.tsx**
   - Terminal on failure toggle
   - Checkpoint capture (on failure, after success)
   - Checkpoint naming (conditional field)
   - Retry configuration (max retries, delay)
   - Max duration override
   - Expected state after action
   - Field preservation across updates

## Test Configuration

### vitest.config.ts

- Uses jsdom environment for DOM testing
- Path alias resolution (@/* → ./src/*)
- Coverage reporting (v8 provider)
- Excludes E2E tests from unit test runs

### src/test/setup.ts

Global test setup that:
- Extends Vitest matchers with jest-dom matchers
- Cleans up after each test
- Mocks browser APIs (matchMedia, IntersectionObserver, ResizeObserver)

## Test Patterns

### Component Testing Pattern

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("MyComponent", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it("should render correctly", () => {
    render(<MyComponent onChange={mockOnChange} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("should handle user interaction", async () => {
    const user = userEvent.setup();
    render(<MyComponent onChange={mockOnChange} />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith(expectedValue);
    });
  });
});
```

### User Interaction Best Practices

1. **Always use `userEvent.setup()`** for realistic user interactions
2. **Use `waitFor`** for async updates
3. **Query by role** when possible (accessibility-friendly)
4. **Clear mocks** in `beforeEach` to ensure test isolation

### Querying Elements

Prefer in order:
1. `getByRole` - Most accessible
2. `getByLabelText` - For form fields
3. `getByPlaceholderText` - For inputs with placeholders
4. `getByText` - For content
5. `getByTestId` - Last resort

## Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

## Common Testing Scenarios

### Testing Switches/Toggles

```typescript
const switches = screen.getAllByRole("switch");
await user.click(switches[0]);

await waitFor(() => {
  expect(mockOnChange).toHaveBeenCalledWith(
    expect.objectContaining({
      field: true,
    })
  );
});
```

### Testing Select Dropdowns

```typescript
const select = screen.getByRole("combobox");
await user.click(select);

const option = screen.getByText("Option 1");
await user.click(option);

await waitFor(() => {
  expect(mockOnChange).toHaveBeenCalledWith(expectedValue);
});
```

### Testing Text Input

```typescript
const input = screen.getByPlaceholderText("Enter name");
await user.type(input, "test value");

await waitFor(() => {
  expect(mockOnChange).toHaveBeenCalled();
});
```

### Testing Tab Navigation

```typescript
const tab = screen.getByText("Tab Name");
await user.click(tab);

await waitFor(() => {
  expect(screen.getByText("Tab Content")).toBeInTheDocument();
});
```

## Troubleshooting

### Tests failing with "not wrapped in act(...)"

Use `waitFor` for async updates:

```typescript
await waitFor(() => {
  expect(mockOnChange).toHaveBeenCalled();
});
```

### Can't find element

1. Use `screen.debug()` to see current DOM
2. Check if element is conditionally rendered
3. Verify element hasn't been removed by cleanup

### Mock not being called

1. Ensure `mockOnChange.mockClear()` in `beforeEach`
2. Use `waitFor` for async updates
3. Check if component is calling the callback

## Adding New Tests

1. Create test file next to component: `MyComponent.test.tsx`
2. Import testing utilities from vitest and @testing-library/react
3. Follow the component testing pattern above
4. Test:
   - Rendering (with/without props)
   - User interactions
   - Edge cases
   - Integration with other components
5. Run tests: `npm test MyComponent.test.tsx`
6. Check coverage: `npm run test:coverage`

## CI/CD Integration

Tests should run in CI/CD pipeline:

```bash
# In CI/CD
npm ci
npm run test:coverage
npm run test:e2e
```

## Next Steps

1. Install dependencies (see Installation section)
2. Add test scripts to package.json (see below)
3. Run tests to verify setup
4. Add more test coverage for other components

## Required package.json Scripts

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```
