import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app/src", import.meta.url)),
    },
  },
  test: {
    include: ["app/src/**/*.test.{ts,tsx}", "packages/*/tests/**/*.test.{ts,tsx}"],
  },
});
