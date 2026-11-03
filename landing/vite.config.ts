// Vite configuration for the landing page. The room serves its index at / and its assets
// under /landing/. The page shows the TV's paintings, which the room serves from /screen/art;
// in development that path is proxied to a plain static server over screen/public.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    root: "landing",
    base: "/landing/",
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
    server: { port: 5183, proxy: { "/screen/art": { target: "http://localhost:8790", rewrite: (path: string) => path.replace(/^\/screen/, "") } } },
});
