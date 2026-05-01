import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/backend/main',
      lib: {
        entry: 'app/backend/electron/main.ts'
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/backend/preload',
      lib: {
        entry: 'app/backend/electron/preload.ts'
      }
    }
  },
  renderer: {
    root: 'app/frontend',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('app/frontend/src')
      }
    },
    build: {
      outDir: 'dist/frontend',
      rollupOptions: {
        input: resolve('app/frontend/index.html')
      }
    }
  }
});
