// Vite configuration for the public stage. Built output is served by the room at /screen/.
// In development the dev server proxies WebSockets to a locally running room.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildInfoFrom } from "../shared/build-info.ts";

export default defineConfig({
    root: "screen",
    base: "/screen/",
    plugins: [react()],
    define: { __BUILD_INFO__: JSON.stringify(buildInfoFrom(process.env)) },
    build: { outDir: "dist", emptyOutDir: true },
    server: { port: 5181, proxy: { "/ws": { target: "ws://localhost:8740", ws: true } } },
});
