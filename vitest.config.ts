import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "external-node-sqlite",
      resolveId(id) {
        if (id === "node:sqlite" || id === "sqlite") return { id: "node:sqlite", external: true };
      },
    },
  ],
});
