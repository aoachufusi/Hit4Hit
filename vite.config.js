import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_GAME_API || 'http://127.0.0.1:3001'

  return {
    plugins: [react()],
    appType: 'spa',
    server: {
      // Listen on IPv4 + IPv6 so both http://127.0.0.1:5173 and http://localhost:5173 work
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
