import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  root: __dirname,
  plugins: [tailwindcss(), tsconfigPaths()],
  optimizeDeps: {
    exclude: ["@lichess-org/chessground"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../build/client",
    emptyOutDir: true,
  },
});
