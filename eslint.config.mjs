// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from 'eslint/config';
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ["**.ts", "**.*.ts"],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/dot-notation": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_"
      }]
    }
  },
  {
    ignores: [
      "node_modules/**",
      "src/node_modules/**",
      "imlformat/node_modules/**",
      "src/out/**",
      "eslint.config.mjs",
      ".vscode-test.mjs"
    ],
  },
);
