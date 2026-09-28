import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.join(process.cwd(), "src/client"),
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/ws": {
        // Proxy WebSocket connections to the development server running on localhost:3000
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
