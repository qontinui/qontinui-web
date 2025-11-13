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
  // Use python -m uvicorn to ensure it works in all environments
  backendProcess = spawn(
    'python',
    ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000'],
    {
      cwd: backendDir,
      stdio: 'pipe',
      detached: false,
      env: {
        ...process.env,
        TESTING: '1',
        ENVIRONMENT: 'development',
        DATABASE_URL: 'postgresql://test_user:test_password@localhost:5432/test_db',
        SECRET_KEY: 'test-secret-key-for-testing-only-minimum-32-chars-required',
        ACCESS_SECRET_KEY: 'test-access-secret-key-minimum-32-characters-required',
        RESET_PASSWORD_SECRET_KEY: 'test-reset-password-secret-key-min-32-chars-required',
        VERIFICATION_SECRET_KEY: 'test-verification-secret-key-min-32-chars-required',
        ALGORITHM: 'HS256',
        FRONTEND_URL: 'http://localhost:3000',
        BACKEND_CORS_ORIGINS: '["http://localhost:3000"]',
        STORAGE_BACKEND: 'local',
        REDIS_ENABLED: 'false',
      },
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

  // Seed test data in the database
  console.log('Seeding test snapshot data...');
  const seedProcess = spawn(
    'python',
    [path.join(backendDir, 'tests', 'utils', 'run_seed.py')],
    {
      cwd: backendDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        TESTING: '1',
        ENVIRONMENT: 'development',
        DATABASE_URL: 'postgresql://test_user:test_password@localhost:5432/test_db',
        SECRET_KEY: 'test-secret-key-for-testing-only-minimum-32-chars-required',
        STORAGE_BACKEND: 'local',
        REDIS_ENABLED: 'false',
      },
    }
  );

  await new Promise<void>((resolve, reject) => {
    let output = '';
    let errorOutput = '';

    seedProcess.stdout?.on('data', (data) => {
      output += data.toString();
      console.log(`Seed: ${data}`);
    });

    seedProcess.stderr?.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`Seed Error: ${data}`);
    });

    seedProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Test data seeding complete');
        resolve();
      } else {
        console.error('Seeding failed:', errorOutput);
        reject(new Error(`Seeding failed with code ${code}`));
      }
    });
  });

  // Note: Frontend server is started by Playwright's webServer config
  // No need to start it here

  console.log('Global E2E test setup complete');
}

export default globalSetup;
