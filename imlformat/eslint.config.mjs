import tseslint from "typescript-eslint";
import eslint from "@eslint/js";

export default tseslint.config(
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
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/dot-notation": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unused-vars": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-argument": "off"
    }
  },
  {
    ignores: [
      "node_modules/**",
      "src/node_modules/**",
      "src/out/**",
      "eslint.config.mjs",
      ".vscode-test.mjs"
    ],
  },
);
