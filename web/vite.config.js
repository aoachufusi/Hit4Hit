import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_GAME_API || "http://127.0.0.1:3000";

  return {
    plugins: [react()],
    appType: "spa",
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "../shared"),
      },
    },
    server: {
      // Listen on IPv4 + IPv6 so both http://127.0.0.1:5173 and http://localhost:5173 work
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
