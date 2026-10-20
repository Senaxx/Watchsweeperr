/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The first test that loads the whole server can take over 5 s on a busy machine or during a Docker build.
  test: { testTimeout: 15_000 }
});
