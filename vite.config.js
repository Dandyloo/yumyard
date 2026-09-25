import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two entry points sharing this repo's lib/ and services/ code:
// index.html   -> src/main.js  (Worker POS, Role 1)
// admin.html   -> src/admin/main.js (Admin app, Role 2)
// Vite's dev server serves any .html file at its path with no config
// needed, but `vite build` only bundles index.html by default - this is
// what makes admin.html part of the production build too.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
