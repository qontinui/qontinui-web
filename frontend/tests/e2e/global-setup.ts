/**
 * Global setup for Playwright E2E tests
 * Runs once before all tests
 */

import { FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('Starting global E2E test setup...');

  // Setup test environment variables
  process.env.NODE_ENV = 'test';

  // Any other global setup tasks
  // - Database seeding
  // - Starting mock services
  // - Creating test data

  console.log('Global E2E test setup complete');
}

export default globalSetup;
