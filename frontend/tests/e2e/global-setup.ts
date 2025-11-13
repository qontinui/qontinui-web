/**
 * Global setup for Playwright E2E tests
 * Runs once before all tests
 */

import { FullConfig } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

let backendProcess: ChildProcess | null = null;

async function waitForBackend(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/docs`);
      if (response.ok) {
        console.log('Backend is ready');
        return true;
      }
    } catch (error) {
      // Backend not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function globalSetup(config: FullConfig) {
  console.log('Starting global E2E test setup...');

  // Setup test environment variables
  process.env.NODE_ENV = 'test';

  // Start backend server
  const backendDir = path.resolve(__dirname, '../../../backend');
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';

  console.log('Starting backend server...');

  // Check if backend is already running
  try {
    const response = await fetch(`${backendUrl}/docs`);
    if (response.ok) {
      console.log('Backend is already running, skipping startup');
      return;
    }
  } catch (error) {
    // Backend not running, start it
  }

  // Start backend with uvicorn
  backendProcess = spawn(
    'uvicorn',
    ['app.main:app', '--host', '0.0.0.0', '--port', '8000'],
    {
      cwd: backendDir,
      stdio: 'pipe',
      detached: false,
    }
  );

  // Store process ID for cleanup
  if (backendProcess.pid) {
    (global as any).__BACKEND_PID__ = backendProcess.pid;
  }

  // Log backend output
  backendProcess.stdout?.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`Backend Error: ${data}`);
  });

  // Wait for backend to be ready
  const isReady = await waitForBackend(backendUrl);
  if (!isReady) {
    throw new Error('Backend failed to start within timeout period');
  }

  console.log('Global E2E test setup complete');
}

export default globalSetup;
