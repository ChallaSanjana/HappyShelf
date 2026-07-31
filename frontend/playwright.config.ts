import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke tests, run against a real backend and a real frontend build.
 *
 * Ports are deliberately not the dev defaults (5000/5173) so a run never
 * collides with, or writes into, a development stack someone has open.
 *
 * The backend is pointed at an unreachable database on purpose. Outside
 * production it falls back to an in-memory store (see config/database.js), so
 * each run starts from a clean slate and cannot touch a real MongoDB. That is
 * also what CI gets, where no database exists at all, so local and CI runs
 * exercise identical behaviour.
 */
const BACKEND_PORT = 5178;
const FRONTEND_PORT = 5174;
const BASE_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // The smoke test is one ordered journey; running its steps in parallel
  // would be meaningless. Workers stay at 1 so the in-memory backend is not
  // shared between concurrent tests.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm start',
      cwd: '../backend',
      // A URL probe rather than a port check: the port is listening before
      // the app finishes wiring up, and "socket open" is not "ready".
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(BACKEND_PORT),
        NODE_ENV: 'test-e2e',
        // Port 1 is never listening, so the connection fails immediately and
        // the in-memory fallback engages. dotenv does not override variables
        // already present in the environment, so backend/.env cannot pull a
        // real database back in.
        MONGODB_URI: 'mongodb://127.0.0.1:1/happyshelf-e2e',
        MONGO_TIMEOUT_MS: '1000',
        JWT_SECRET: 'e2e-secret',
        CORS_ORIGIN: BASE_URL,
        // No ML service runs during E2E; the backend falls back to its JS
        // heuristic. Kept short so predictions do not stall the page.
        ML_SERVICE_TIMEOUT_MS: '1000',
      },
    },
    {
      // --host 127.0.0.1 is required: Vite otherwise binds IPv6 (::1) only,
      // and Playwright's readiness probe and baseURL both use IPv4, which
      // then gets ECONNREFUSED even though the server is up.
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort --host 127.0.0.1`,
      // Same reasoning, and it matters more here: Vite binds the port well
      // before it has finished optimising dependencies and can serve the
      // app, so a port check let the first test navigate to a page that
      // never rendered.
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        VITE_API_URL: `http://127.0.0.1:${BACKEND_PORT}/api`,
      },
    },
  ],
});
