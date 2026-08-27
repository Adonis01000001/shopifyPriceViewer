import { defineConfig } from "vitest/config";
import path from "path";
// The tests need a database, and it is already configured in .env. Reading it
// here means `pnpm test` works on its own rather than needing DATABASE_URL
// spelled out on every invocation.
import "dotenv/config";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  },
});
