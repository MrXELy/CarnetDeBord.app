import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/CarnetDeBord.app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      // Police Manrope gardée hors ligne : seulement les caractères latins, utiles en français.
      workbox: { globPatterns: ['**/*.{js,css,html}', '**/manrope-latin-*.woff2'] },
      manifest: {
        name: 'CarnetDeBord.app',
        short_name: 'CarnetDeBord',
        description: 'Suivi des trajets du chauffeur routier',
        lang: 'fr',
        theme_color: '#07080c',
        background_color: '#07080c',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
