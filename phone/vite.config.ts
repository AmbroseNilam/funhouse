// Vite configuration for the private stage. Built output is served by the room at /phone/.
// In development the dev server proxies WebSockets to a locally running room.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildInfoFrom } from "../shared/build-info.ts";

export default defineConfig({
    root: "phone",
    base: "/phone/",
    plugins: [react()],
    define: { __BUILD_INFO__: JSON.stringify(buildInfoFrom(process.env)) },
    build: { outDir: "dist", emptyOutDir: true },
    server: { port: 5182, host: true, proxy: { "/ws": { target: "ws://localhost:8740", ws: true } } },
});
