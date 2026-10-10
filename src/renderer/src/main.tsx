import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import { App } from "./App";
import { connectEngine } from "./store";

// Subscribed once, outside React. Doing it inside a component would install a
// second listener under StrictMode's double-invocation and duplicate every event.
connectEngine();

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
