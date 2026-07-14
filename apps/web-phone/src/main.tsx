import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { PhoneApp } from "./PhoneApp";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PhoneApp />
  </React.StrictMode>,
);
