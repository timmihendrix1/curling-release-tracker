// Independent static-cycle repro: isolate actual transpiled source so a broken
// implementation cannot starve this test runner's event loop. No production timer.
import { afterAll, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
const directory = mkdtempSync(join(tmpdir(), "curling-s5k-cycle-"));
const moduleFile = join(directory, "platformSha256.cjs");
writeFileSync(moduleFile, ts.transpileModule(readFileSync(join(process.cwd(), "src/lib/persistence/platformSha256.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText);
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });
it.each(["ordinary", "malformed_native_method", "malformed_thenable_method"] as const)("refuses static %s cycle without starving later work", kind => {
  const setup = kind === "ordinary" ? "const value={then(resolve){resolve(value)}};" : kind === "malformed_native_method" ? "const value={};const fulfilled=Promise.resolve(value);value.then=fulfilled;" : "const value={};value.then={then(resolve){resolve(value)}};";
  const code = `const {capturePlatformSha256}=require(${JSON.stringify(moduleFile)});${setup}const cap=capturePlatformSha256(()=>value);cap.value.hash('synthetic').then(()=>process.stdout.write('wrong'),()=>process.stdout.write('refused'));setTimeout(()=>process.stdout.write(':timer'),10);`;
  const result = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 2000 });
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stdout).toBe("refused:timer");
});
