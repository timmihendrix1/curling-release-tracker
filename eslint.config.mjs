import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local Supabase CLI-generated metadata. `supabase start` writes bundled,
    // machine-generated TypeScript into `supabase/.temp/start-secrets/` for the
    // edge-runtime container; linting it produces hundreds of irrelevant
    // findings (`no-var`, `prefer-const`, unused vars in minified output) and
    // makes `npm run lint` fail for anyone who happens to have the local stack
    // running. `.gitignore` already classifies both of these directories as
    // local CLI-generated metadata, so nothing inside them is ever reviewed or
    // committed — this keeps ESLint's view consistent with that.
    //
    // Deliberately narrow: NOT `supabase/**`. The tracked migrations, the pgTAP
    // suite and `supabase/config.toml` stay lint-visible, so real Supabase
    // sources are never silently excluded.
    "supabase/.temp/**",
    "supabase/.branches/**",
  ]),
]);

export default eslintConfig;
