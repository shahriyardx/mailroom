import "@/assets/tailwind.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// The same page is both the toolbar popup and, when opened in a tab, the
// roomy two-pane version. The class is what the stylesheet branches on.
const inTab = new URLSearchParams(window.location.search).get("tab") === "1";
if (inTab) document.documentElement.classList.add("in-tab");

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App inTab={inTab} />
  </StrictMode>,
);
