// Mounts the private stage.

import "@fontsource-variable/fraunces/full.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { reloadWhenUpdated } from "./freshness.ts";
import { fitAboveKeyboard } from "./keyboard.ts";

const root: HTMLElement | null = document.getElementById("root");
if (root === null) {
    throw new Error("Missing #root element.");
}
createRoot(root).render(<StrictMode><App /></StrictMode>);
reloadWhenUpdated();
fitAboveKeyboard();
// Installing is optional and never asked for, so Chrome's own prompt stays out of the way.
addEventListener("beforeinstallprompt", (event: Event) => { event.preventDefault(); });
