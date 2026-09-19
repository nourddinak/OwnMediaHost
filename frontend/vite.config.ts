import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:8080';
  const port = Number(env.VITE_PORT) || 5173;

  return {
    plugins: [react()],
    server: {
      port,
      host: true,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/f': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/i': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/a': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/thumbnails': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/private': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/docs': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
