// Mounts the private stage.

import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root: HTMLElement | null = document.getElementById("root");
if (root === null) {
    throw new Error("Missing #root element.");
}
createRoot(root).render(<StrictMode><App /></StrictMode>);
