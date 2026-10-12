import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./base.css";
import "./app.css";
import { MainApp } from "./main/MainApp";
import { ToastApp } from "./toast/ToastApp";
import { WarningApp } from "./warning/WarningApp";

// One bundle, three windows: the window's URL hash says which one this is.
const hash = window.location.hash;
const Root = hash.startsWith("#/warning") ? WarningApp : hash.startsWith("#/toast") ? ToastApp : MainApp;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
