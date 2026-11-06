import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./theme.css";
import "./research.css";
import { installScrollHints } from "./lib/scrollHints";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
installScrollHints(document.getElementById("root")!);
