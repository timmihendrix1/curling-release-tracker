import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output and the Capacitor-generated native project. `ios/` holds generated
    // Swift/Xcode sources, not TypeScript, and `dist/` is a build product.
    ignores: ["dist/**", "ios/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // `eslint.config.mjs` is JavaScript and is not part of the TypeScript
        // program, so the project service has to be told it may still be linted.
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.test.ts", "src/__tests__/**/*.ts"],
    rules: {
      // Test doubles deliberately construct partial/awkward shapes.
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  }
);
