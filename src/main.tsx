import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./themes.css";
import { restoreThemeHint } from "./theme";
restoreThemeHint();
history.scrollRestoration = "manual";
createRoot(document.getElementById("root")!).render(<App />);
