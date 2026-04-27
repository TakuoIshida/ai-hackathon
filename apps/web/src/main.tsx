import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { auth } from "./auth";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <auth.Provider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </auth.Provider>
  </StrictMode>,
);
