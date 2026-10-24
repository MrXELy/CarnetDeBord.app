/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  addFinish,
  DONE_TAG,
  FINISH_ACTION,
  FINISH_MESSAGE,
  finishedText,
  type StepNoticeData,
} from './lib/notifiedFinishes';

/*
 * Service worker : appli gardée hors ligne (fichiers listés à la construction par vite-plugin-pwa) et bouton
 * « Fin du chargement / de la livraison » des notifications, qui marche même appli fermée.
 */

declare let self: ServiceWorkerGlobalScope;

// Mise à jour automatique : la nouvelle version prend la main tout de suite.
void self.skipWaiting();
clientsClaim();

const manifest = self.__WB_MANIFEST;
precacheAndRoute(manifest);
cleanupOutdatedCaches();
// Toute adresse de l'appli ouvre index.html (hors ligne compris). Pas sur le serveur de test : rien n'y est gardé.
if (import.meta.env.PROD) registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

const icon = new URL('icons/icon-192.png', self.registration.scope).href;

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const data = notification.data as StepNoticeData | null;
  notification.close();
  if (event.action === FINISH_ACTION && data?.eventId) event.waitUntil(finish(data));
  else event.waitUntil(openApp());
});

/** Bouton de la notification : garde l'heure du toucher, prévient l'appli si elle est ouverte, puis confirme. */
async function finish(data: StepNoticeData) {
  const at = new Date();
  await addFinish({ eventId: data.eventId, finishedAt: at.toISOString() });
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((w) => w.postMessage({ type: FINISH_MESSAGE }));
  await self.registration.showNotification(finishedText(data.type, at), { tag: DONE_TAG, icon, silent: true });
  // Confirmation retirée après quelques secondes.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  (await self.registration.getNotifications({ tag: DONE_TAG })).forEach((n) => n.close());
}

/** Toucher le texte de la notification : ouvre l'appli (ou la remet devant si elle est déjà ouverte). */
async function openApp() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windows[0]) return windows[0].focus();
  return self.clients.openWindow(self.registration.scope);
}
