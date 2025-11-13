/**
 * Global teardown for Playwright E2E tests
 * Runs once after all tests
 */

import { FullConfig } from '@playwright/test';

async function globalTeardown(config: FullConfig) {
  console.log('Starting global E2E test teardown...');

  // Stop frontend server if we started it
  const frontendPid = (global as any).__FRONTEND_PID__;
  if (frontendPid) {
    console.log(`Stopping frontend server (PID: ${frontendPid})...`);
    try {
      process.kill(frontendPid, 'SIGTERM');
      console.log('Frontend server stopped');
    } catch (error) {
      console.error('Failed to stop frontend server:', error);
    }
  }

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
