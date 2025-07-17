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
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/dot-notation": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
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
