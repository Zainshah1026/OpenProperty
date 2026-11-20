import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";
import { applyTheme, getTheme } from "./lib/theme";

applyTheme(getTheme());
// On "Auto", follow the phone or computer when it switches between light and dark.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme(getTheme()));

createRoot(document.getElementById("app")!).render(<App />);

// Lets phones and computers install the dashboard as an app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
