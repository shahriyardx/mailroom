import "@/assets/tailwind.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
