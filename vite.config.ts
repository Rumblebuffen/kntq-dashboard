import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (served from /kntq-dashboard/) and on Cloudflare Pages (served from /).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5183 },
});
