const { resolve } = require("node:path");

const project = resolve(process.cwd(), "tsconfig.json");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["opengovsg"],
  ignorePatterns: ["dist/**/*", "vitest.config.ts", "vitest.setup.ts"],
  plugins: ["import", "eslint-plugin-tsdoc"],
  rules: {
    "import/no-unresolved": "error",
    "tsdoc/syntax": "error",
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "**/tsconfig.json",
  },
  settings: {
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"],
    },
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true,
        project: project,
      },
    },
  },
};
