// Lint rules that enforce the parts of the engineering standard a machine can check:
// braces on every block, strict equality, no floating promises, explicit type imports,
// and 4-space indentation. The rest (no else, file headers) is checked by tools/verify.py.

import eslintJavaScript from "@eslint/js";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
    { ignores: ["dist/", "node_modules/", "screen/dist/", "phone/dist/", "tools/out/", "phone/public/"] },
    eslintJavaScript.configs.recommended,
    ...typescriptEslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: { allowDefaultProject: ["eslint.config.js"] },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "curly": ["error", "all"],
            "eqeqeq": ["error", "always"],
            "no-var": "error",
            "prefer-const": "error",
            "no-console": ["error", { allow: ["warn", "error"] }],
            "max-len": ["warn", { code: 180, ignoreUrls: true, ignoreStrings: true }],
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
            "@typescript-eslint/no-unnecessary-condition": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
    {
        files: ["tools/**/*.ts"],
        rules: { "no-console": "off" },
    },
    {
        // node:test's describe() and it() return promises that the runner owns.
        files: ["**/*.test.ts"],
        rules: { "@typescript-eslint/no-floating-promises": "off" },
    },
);
