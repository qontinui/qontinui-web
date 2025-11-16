/**
 * Global teardown for Playwright E2E tests
 * Runs once after all tests
 */

import { FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig) {
  console.log('Starting global E2E test teardown...');

  // Note: Frontend server is managed by Playwright's webServer config
  // No need to stop it here

  // Stop backend server if we started it
  const backendPid = (global as any).__BACKEND_PID__;
  if (backendPid) {
    console.log(`Stopping backend server (PID: ${backendPid})...`);
    try {
      process.kill(backendPid, 'SIGTERM');
      console.log('Backend server stopped');
    } catch (error) {
      console.error('Failed to stop backend server:', error);
    }
  }

  // Cleanup tasks
  // - Remove test data
  // - Stop mock services
  // - Clean up test artifacts

  console.log('Global E2E test teardown complete');
}

export default globalTeardown;
