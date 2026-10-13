import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";

createRoot(document.getElementById("app")!).render(<App />);

// Lets phones and computers install the dashboard as an app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
