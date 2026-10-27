import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
history.scrollRestoration = "manual";
createRoot(document.getElementById("root")!).render(<App />);
