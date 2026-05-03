import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0, // Don't inline WASM files
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
});
