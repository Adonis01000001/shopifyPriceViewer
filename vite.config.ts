import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const plugins = [react(), ...(tailwindcss() as any)];

export default defineConfig(({ mode }) => {
  const root = path.resolve(import.meta.dirname);
  const buildEnv = loadEnv(mode, root, "VITE_");
  if (mode === "production" && buildEnv.VITE_BYPASS_AUTH === "true") {
    throw new Error("Production client builds cannot enable VITE_BYPASS_AUTH");
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(root, "client", "src"),
        "@shared": path.resolve(root, "shared"),
        "@assets": path.resolve(root, "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    envDir: root,
    root: path.resolve(root, "client"),
    publicDir: path.resolve(root, "client", "public"),
    build: {
      outDir: path.resolve(root, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      host: true,
      allowedHosts: ["localhost", "127.0.0.1"],
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
