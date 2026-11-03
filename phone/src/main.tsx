// Mounts the private stage.

import "@fontsource-variable/fraunces/full.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { TuneScreen } from "./TuneScreen.tsx";

const root: HTMLElement | null = document.getElementById("root");
if (root === null) {
    throw new Error("Missing #root element.");
}
const tuning: boolean = new URLSearchParams(location.search).get("tune") === "1";
createRoot(root).render(<StrictMode>{tuning === true ? <TuneScreen /> : <App />}</StrictMode>);
