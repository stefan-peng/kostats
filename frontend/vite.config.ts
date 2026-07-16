import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-is/") ||
            id.includes("/scheduler/")
          ) {
            return "react";
          }
          if (id.includes("/recharts/") || id.includes("/d3-")) {
            return "charts";
          }
          if (id.includes("/radix-ui/") || id.includes("/@radix-ui/")) {
            return "radix";
          }
          if (id.includes("/@tanstack/")) {
            return "table";
          }

          return;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    allowedHosts: ["freya", "localhost", "127.0.0.1"],
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
