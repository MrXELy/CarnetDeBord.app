import { useEffect } from 'react';
import type { TripEvent } from '../types';
import { timeLabel } from './dates';
import { formatPlace } from './geo';
import {
  FINISH_ACTION,
  FINISH_MESSAGE,
  STEP_TAG,
  takeFinishes,
  type NotifiedFinish,
  type StepNoticeData,
} from './notifiedFinishes';
import { hasEnd } from './onSite';
import { useSettings } from './settings';
import type { EventStore } from './sync';

/*
 * Notification de l'étape en cours (chargement ou livraison sans fin) avec le bouton « Fin de la livraison » :
 * pas besoin d'ouvrir l'appli pour noter la fin. Réglage par appareil (Options), permission de Chrome demandée
 * à l'activation. Le toucher du bouton est traité par le service worker (`src/sw.ts`).
 */

/** Notifications possibles dans ce navigateur. */
export const notificationsSupported = () => 'Notification' in globalThis && 'serviceWorker' in navigator;

/** Titre, texte et bouton de la notification d'une étape. */
export function stepNotice(step: TripEvent) {
  const loading = step.type === 'chargement';
  return {
    title: loading ? 'Chargement en cours' : 'Livraison en cours',
    body: [formatPlace(step), `Arrivée à ${timeLabel(step.occurred_at)}`].filter(Boolean).join(' · '),
    action: loading ? 'Fin du chargement' : 'Fin de la livraison',
  };
}

/**
 * Applique les fins notées depuis la notification. Ignorées : étape supprimée, inconnue (autre compte)
 * ou déjà finie dans l'appli (la fin validée là compte).
 */
export function applyFinishes(store: Pick<EventStore, 'event' | 'finishStep'>, finishes: NotifiedFinish[]) {
  for (const { eventId, finishedAt } of finishes) {
    const event = store.event(eventId);
    if (event && hasEnd(event.type) && !event.finished_at) store.finishStep(eventId, finishedAt);
  }
}

/** Montre la notification de l'étape en cours, ou la retire s'il n'y en a plus (ou si le réglage est coupé). */
async function updateStepNotice(step: TripEvent | null, enabled: boolean) {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const shown = await registration.getNotifications({ tag: STEP_TAG });
  if (!step || !enabled || Notification.permission !== 'granted') return shown.forEach((n) => n.close());
  const { title, body, action } = stepNotice(step);
  // Déjà affichée telle quelle : pas de nouvelle (sinon elle remonterait à chaque changement de l'appli).
  if (shown.some((n) => (n.data as StepNoticeData | null)?.eventId === step.id && n.body === body)) return;
  const data: StepNoticeData = { eventId: step.id, type: step.type as StepNoticeData['type'] };
  await registration.showNotification(title, {
    body,
    tag: STEP_TAG,
    icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
    data,
    // Notée en arrivant, appli ouverte : pas de sonnerie ; reste affichée jusqu'à la fin (PC compris).
    silent: true,
    requireInteraction: true,
    actions: [{ action: FINISH_ACTION, title: action }],
  } as NotificationOptions);
}

/**
 * Mises à jour l'une après l'autre : sinon, à l'ouverture, la notification de l'étape pouvait réapparaître
 * juste après avoir été retirée (fin notée depuis la notification, appliquée pendant qu'elle s'affichait).
 */
let updates: Promise<void> = Promise.resolve();

/** Notification de l'étape en cours, et fins notées depuis la notification appliquées dès que l'appli les voit. */
export function useStepNotification(store: EventStore, step: TripEvent | null) {
  const { stepNotifications } = useSettings();

  useEffect(() => {
    if (!notificationsSupported()) return;
    // Service worker pas encore prêt : réessayé au prochain changement.
    updates = updates.then(() => updateStepNotice(step, stepNotifications)).catch(() => {});
  }, [step, stepNotifications]);

  useEffect(() => {
    if (!notificationsSupported()) return;
    const apply = () => {
      takeFinishes()
        .then((finishes) => applyFinishes(store, finishes))
        .catch(() => {});
    };
    const onMessage = (e: MessageEvent) => e.data?.type === FINISH_MESSAGE && apply();
    const onVisible = () => document.visibilityState === 'visible' && apply();
    apply();
    navigator.serviceWorker.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);
}
