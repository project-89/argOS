import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/app/',  // Base path for production build
  server: {
    proxy: {
      // Proxy WebSocket connections to the argos server
      '/bus': {
        target: 'ws://localhost:3000',
        ws: true,
        // Suppress connection errors during startup
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // Silently ignore connection refused errors (server still starting)
            if ((err as NodeJS.ErrnoException).code !== 'ECONNREFUSED') {
              console.error('[proxy]', err.message);
            }
          });
        },
      },
    },
  },
})
