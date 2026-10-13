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
  },
  preview: {
    headers: isolationHeaders,
  },
});
