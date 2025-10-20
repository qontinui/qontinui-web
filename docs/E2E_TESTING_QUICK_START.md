# E2E Testing Quick Start Guide

Quick reference for running integration tests.

## Prerequisites

### Backend
```bash
cd backend
pip install -e .
pip install pytest pytest-cov pytest-asyncio
```

### Frontend
```bash
cd frontend
npm install
npx playwright install --with-deps
```

## Running Tests

### Backend Tests

```bash
cd backend

# Run all E2E tests
pytest tests/test_integration_e2e.py -v

# Run with coverage
pytest tests/test_integration_e2e.py -v --cov=app --cov-report=html

# Run specific test class
pytest tests/test_integration_e2e.py::TestCompleteWorkflow -v

# Run in parallel (faster)
pytest tests/test_integration_e2e.py -v -n auto
```

### Frontend Tests

```bash
cd frontend

# Run all E2E tests
npm run test:e2e

# Run with UI (interactive)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run in debug mode
npm run test:e2e:debug

# Run specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:webkit

# View report
npm run test:e2e:report
```

## Viewing Results

### Backend Coverage
```bash
cd backend
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

### Frontend Report
```bash
cd frontend
npx playwright show-report
```

## CI/CD

Tests run automatically on:
- Pull requests to main/develop
- Pushes to main/develop

View results in GitHub Actions tab.

## Common Commands

### Backend
```bash
# Run only integration tests
pytest -m integration -v

# Exclude slow tests
pytest -m "not slow" -v

# Run with verbose output
pytest tests/test_integration_e2e.py -vv -s
```

### Frontend
```bash
# Run specific test
npx playwright test -g "should export execution to PDF"

# Update snapshots
npx playwright test --update-snapshots

# Generate trace
npx playwright test --trace on
```

## Troubleshooting

### Backend
```bash
# If imports fail
cd backend
pip install -e .

# Set test environment
export TESTING=1
export ENVIRONMENT=test
```

### Frontend
```bash
# If Playwright not installed
npx playwright install --with-deps

# If tests are flaky
npx playwright test --retries=2
```

## Test Structure

```
backend/tests/
├── conftest.py                     # Fixtures
├── test_integration_e2e.py         # E2E tests
└── utils/
    └── integration_test_helpers.py # Utilities

frontend/tests/e2e/
├── fixtures.ts                     # Fixtures
├── global-setup.ts                 # Setup
├── global-teardown.ts              # Teardown
└── integration-testing.spec.ts    # E2E tests
```

## Key Test Scenarios

### Backend
- Complete workflow (single/multi-snapshot)
- Error scenarios (missing data, failures)
- Duplicate detection
- Priority weighting
- Smart recommendations
- Coverage reporting
- Export functionality

### Frontend
- Page navigation and display
- Process and snapshot selection
- Execution and visualization
- Timeline playback
- PDF and video export
- Error handling
- Manual selection mode

## Test Coverage

Target: 85%+ code coverage

Backend: Tests service layer, API endpoints, utilities
Frontend: Tests user workflows, UI interactions, API integration

## For More Information

See full documentation: `docs/E2E_TESTING.md`
