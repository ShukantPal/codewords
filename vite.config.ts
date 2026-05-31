import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';

const backendUrl = process.env.VITE_CODEWORDS_BACKEND_URL ?? 'https://codewords.shukant.com';
const backendWsUrl = backendUrl.replace(/^http/, 'ws');
const localTalonCopilot = '/Users/shukant/Workspace/impalasys/talon/packages/copilot/src/index.ts';
const localTalonCopilotSource = '/Users/shukant/Workspace/impalasys/talon/packages/copilot/src';
const fsAllow = ['.'];
if (existsSync(localTalonCopilotSource)) {
  fsAllow.push(localTalonCopilotSource);
}

export default defineConfig(({ command }) => {
  const useLocalTalonCopilot = command === 'serve' && existsSync(localTalonCopilot);
  return {
    plugins: [react()],
    optimizeDeps: {
      exclude: useLocalTalonCopilot ? ['@talonai/copilot'] : [],
    },
    server: {
      fs: {
        allow: fsAllow,
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
        ...(useLocalTalonCopilot ? { '@talonai/copilot': localTalonCopilot } : {}),
      },
    },
  };
});
