import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./index.css";
import App from "./App.tsx";
import { ApplicationRoot } from "./ApplicationRoot";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApplicationRoot administrator={<App />} />
  </StrictMode>,
);
