import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Version affichée en bas des Options : commit construit et heure de construction.
function buildCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'inconnu';
  }
}

export default defineConfig({
  base: '/CarnetDeBord.app/',
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  // jsPDF n'est importé qu'au clic sur « Feuille » : préparé dès le démarrage du serveur de test,
  // sinon Vite le découvre à ce moment-là et recharge toute la page (retour à la semaine en cours).
  optimizeDeps: { include: ['jspdf'] },
  plugins: [
    // Serveur de test en https (certificat fait maison) : sur le téléphone, l'adresse en 192.168…
    // n'est sinon pas une connexion sécurisée, et le navigateur bloque crypto.randomUUID et le GPS.
    // Sans effet sur la version en ligne (build).
    basicSsl(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      // Police Figtree gardée hors ligne : seulement les caractères latins, utiles en français.
      workbox: { globPatterns: ['**/*.{js,css,html}', '**/figtree-latin-*.woff2'] },
      manifest: {
        name: 'CarnetDeBord.app',
        short_name: 'CarnetDeBord',
        description: 'Suivi des trajets du chauffeur routier',
        lang: 'fr',
        theme_color: '#1a1c22',
        background_color: '#1a1c22',
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
