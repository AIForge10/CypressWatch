import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable, offline-first crew app (service worker + manifest).
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      manifest: {
        name: 'CypressWatch Crew',
        short_name: 'CypressWatch',
        theme_color: '#0b1f17',
        background_color: '#0b1f17',
        display: 'standalone',
      },
    }),
  ],
});
