import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT (GitHub Pages):
// Set base to '/<repo-name>/' (e.g. '/bemanning-prototype/') so assets load correctly.
// If you use a custom domain or deploy at root, you can keep base as '/'.
export default defineConfig({
  plugins: [react()],
  base: "/",
});
