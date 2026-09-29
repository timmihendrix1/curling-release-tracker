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
    // The standalone Brower iOS BLE probe (docs/BROWER_IOS_FEASIBILITY.md) is a
    // separate project with its own ESLint configuration, its own TypeScript
    // program and its own `npm run lint`. It also contains generated artefacts
    // this config has no business reading: the Vite build output copied into the
    // native app bundle, and the Capacitor-generated Xcode project.
    //
    // Deliberately narrow: this names that one project, NOT `tools/**`, so any
    // future tool added under tools/ stays lint-visible here until someone
    // decides otherwise.
    "tools/brower-ios-probe/**",
    // Generated output of the mobile client build (mobile/vite.config.ts) and
    // the Capacitor-generated native iOS project. Deliberately narrow: the
    // mobile SOURCE (mobile/src, mobile/__tests__, the configs and
    // capacitor.config.ts) stays lint-visible and is covered by `npm run
    // mobile:lint` as well as the root `npm run lint`.
    "mobile/dist/**",
    "ios/App/App/public/**",
  ]),
]);

export default eslintConfig;
