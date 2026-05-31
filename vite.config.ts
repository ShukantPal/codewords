import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendUrl = process.env.VITE_CODEWORDS_BACKEND_URL ?? 'https://codewords.shukant.com';
const backendWsUrl = backendUrl.replace(/^http/, 'ws');
const localTalonCopilot = '/Users/shukant/Workspace/impalasys/talon/packages/copilot/src/index.ts';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@talonai/copilot'],
  },
  server: {
    fs: {
      allow: [
        '.',
        '/Users/shukant/Workspace/impalasys/talon/packages/copilot/src',
      ],
    },
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/talon': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/mcp': {
        target: backendUrl,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWsUrl,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': new URL('.', import.meta.url).pathname,
      '@talonai/copilot': localTalonCopilot,
    },
  },
});
