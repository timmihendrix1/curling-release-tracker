import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { build } from "vite";

it("builds only the exact isolated helper closure without loading app configuration", async () => {
  const root = process.cwd();
  const result = await build({ configFile: resolve(root, "transfer-source/vite.config.ts"), logLevel: "silent", build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(result => "output" in result ? result.output : []);
  const chunks = outputs.filter(item => item.type === "chunk");
  expect(chunks.length > 0).toBe(true);
  const modules = [...new Set(chunks.flatMap(chunk => Object.entries(chunk.modules).filter(([, metadata]) => metadata.renderedLength > 0).map(([id]) => id.replace(root + "/", ""))))].sort();
  expect(modules).toEqual([
    "\0vite/preload-helper.js",
    "node_modules/@capacitor/app/dist/esm/index.js", "node_modules/@capacitor/app/dist/esm/web.js", "node_modules/@capacitor/core/dist/index.js",
    "src/lib/identity/identityBarrier.ts", "src/lib/identity/identityBarrierResolution.ts", "src/lib/identity/interactiveAttempt.ts", "src/lib/identity/trustedDevice.ts",
    "src/lib/persistence/installationTransferInventory.ts", "src/lib/persistence/localStorageAdapter.ts", "src/lib/persistence/nativeMigrationEligibility.ts",
    "src/lib/persistence/platformSha256.ts", "src/lib/persistence/types.ts", "src/lib/uuid.ts",
    "transfer-source/src/main.ts", "transfer-source/src/sourceHelper.ts",
  ].sort());
  const code = chunks.map(chunk => chunk.code).join("\n");
  // Inventory needs the credential exclusion stem; that is no credential read.
  for (const marker of ["setItem", "removeItem", "clear()", "createClient", "createIdentityRuntime", "@supabase", "CapacitorSQLite", "CredentialKeychainReader", "curling-installation-transfer", "curling-protected-installation-v1", "owner_frozen", "NEXT_PUBLIC_"]) {
    expect(code.includes(marker), marker).toBe(false);
  }
  // Installed Core's generic HTTP definitions are admitted, never called by the
  // helper. Absence of all generic fetch text would be a false artifact claim.
  expect(code.includes("CapacitorHttp")).toBe(true);
  const htmlAsset = outputs.find(item => item.type === "asset" && item.fileName === "index.html");
  expect(htmlAsset?.type).toBe("asset");
  if (!htmlAsset || htmlAsset.type !== "asset") throw new Error("Isolated HTML missing");
  const html = typeof htmlAsset.source === "string" ? htmlAsset.source : Buffer.from(htmlAsset.source).toString("utf8");
  for (const policy of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'"]) expect(html.includes(policy)).toBe(true);
  expect(html.includes('id="inspect" type="button" disabled')).toBe(true);
  const config = readFileSync(resolve(root, "transfer-source/vite.config.ts"), "utf8");
  expect(config.includes("envDir: false")).toBe(true); expect(config.includes("publicDir: false")).toBe(true);
  expect(config.includes("loadEnv")).toBe(false); expect(config.includes("../node_modules/.vite-transfer-source")).toBe(true);
  expect(readFileSync(resolve(root, "capacitor.config.ts"), "utf8").includes('webDir: "mobile/dist"')).toBe(true);
  expect(readFileSync(resolve(root, "eslint.config.mjs"), "utf8").includes('"transfer-source/dist/**"')).toBe(true);
});
