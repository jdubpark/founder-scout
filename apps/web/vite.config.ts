import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Two builds from one codebase:
 *  - default: the dashboard, served by the API server and talking to /api;
 *  - `--mode demo`: one self-contained HTML file with a frozen snapshot of
 *    simulated data and no network calls, for sharing as a static page.
 */
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    plugins: [react(), tailwindcss(), ...(demo ? [viteSingleFile()] : [])],
    define: { __DEMO__: JSON.stringify(demo) },
    build: {
      outDir: demo ? "dist-demo" : "dist",
      emptyOutDir: true,
      // The demo build inlines fonts and code into the single file.
      assetsInlineLimit: demo ? 100_000_000 : 4096,
    },
    server: {
      port: 5317,
      proxy: { "/api": { target: "http://127.0.0.1:4317", changeOrigin: false } },
    },
  };
});
