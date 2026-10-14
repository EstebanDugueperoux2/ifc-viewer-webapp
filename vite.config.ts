import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// @ifc-lite/geometry@7.8.1 ships compiled JS but its worker URL still points to
// "./geometry.worker.ts". Rewrite it to the .js file that actually exists in dist/.
const fixIfcLiteWorkerUrl = (): Plugin => ({
  name: 'fix-ifc-lite-worker-url',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('@ifc-lite/geometry') && code.includes('geometry.worker.ts')) {
      return { code: code.replaceAll('geometry.worker.ts', 'geometry.worker.js'), map: null };
    }
    return null;
  },
});

export default defineConfig({
  plugins: [fixIfcLiteWorkerUrl(), react()],
  optimizeDeps: {
    exclude: ['@ifc-lite/wasm', '@ifc-lite/geometry'],
  },
  worker: {
    format: 'es',
    plugins: () => [fixIfcLiteWorkerUrl()],
  },
  server: {
    headers: isolationHeaders,
    // Same-origin access to the IFC-Lite server (docker compose up -d in ifc-server).
    proxy: {
      // Same-origin access to the model store (docker compose up -d in ifc-server).
      '/model-api': {
        target: process.env.MODEL_STORE_URL ?? 'http://localhost:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/model-api/, ''),
      },
      // Same-origin access to the AI assistant (docker compose up -d in ifc-server).
      '/assistant-api': {
        target: process.env.ASSISTANT_URL ?? 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/assistant-api/, ''),
      },
      '/ifc-api': {
        target: process.env.IFC_SERVER_URL ?? 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ifc-api/, ''),
      },
    },
  },
  preview: {
    headers: isolationHeaders,
  },
});
