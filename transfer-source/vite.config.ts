import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root, base: "./", envDir: false, publicDir: false,
  cacheDir: path.resolve(root, "../node_modules/.vite-transfer-source"),
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: path.join(root, "dist"), emptyOutDir: true, target: "es2022", sourcemap: false, modulePreload: false },
});
