/**
 * Standalone browser build.
 *
 * No server, no sign-in, no network. Home() with no props persists to
 * localStorage, which is exactly what the hosted version needs.
 */
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(<Home />);
