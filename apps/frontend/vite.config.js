import tailwindcss from '@tailwindcss/vite';
import {tanstackRouter} from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import {defineConfig, loadEnv} from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiPort = env.PORT || '3000';
  const apiTarget = env.CLIPARR_API_URL || `http://localhost:${apiPort}`;
  return {
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('/node_modules/mediabunny/dist/modules/src/')) {
              return;
            }

            if (id.includes('/codec-data.js')) return 'mediabunny-codec-data';
            if (id.includes('/media-sink.js') || id.includes('/media-source.js') || id.includes('/sample.js')) {
              return 'mediabunny-media';
            }
          },
        },
      },
    },
    resolve: {
      dedupe: ['mediabunny'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
