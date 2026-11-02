// Vite configuration for the landing page. The room serves its index at / and its assets
// under /landing/.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    root: "landing",
    base: "/landing/",
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
});
