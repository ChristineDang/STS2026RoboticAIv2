import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dashboard dev server port (the backend port lives in src/api/backend.ts).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
