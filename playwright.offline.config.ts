import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const port = Number(process.env.E2E_PORT || 4173)
export default defineConfig({
  ...base,
  testMatch: ['flowers.spec.ts', 'lotus-legacy.smoke.spec.ts', 'blood-flow.local.spec.ts'],
  // This mixed legacy spec also contains a WS room test requiring the backend.
  grepInvert: /in WS rooms/,
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
