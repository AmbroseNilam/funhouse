// Vite configuration for the public stage. Built output is served by the room at /screen/.
// In development the dev server proxies WebSockets to a locally running room.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    root: "screen",
    base: "/screen/",
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
    server: { port: 5181, proxy: { "/ws": { target: "ws://localhost:8740", ws: true } } },
});
