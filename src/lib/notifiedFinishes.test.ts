import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addFinish, finishedText, takeFinishes } from './notifiedFinishes';

describe('fins notées depuis la notification', () => {
  it('sont gardées puis retirées une seule fois', async () => {
    await addFinish({ eventId: 'a', finishedAt: '2026-10-20T09:40:00.000Z' });
    await addFinish({ eventId: 'b', finishedAt: '2026-10-20T15:20:00.000Z' });
    expect((await takeFinishes()).map((f) => f.eventId).sort()).toEqual(['a', 'b']);
    expect(await takeFinishes()).toEqual([]);
  });

  it('un second toucher sur la même étape remplace le premier', async () => {
    await addFinish({ eventId: 'a', finishedAt: '2026-10-20T09:40:00.000Z' });
    await addFinish({ eventId: 'a', finishedAt: '2026-10-20T09:41:00.000Z' });
    expect(await takeFinishes()).toEqual([{ eventId: 'a', finishedAt: '2026-10-20T09:41:00.000Z' }]);
  });

  it('confirmation avec le type et l’heure', () => {
    expect(finishedText('chargement', new Date('2026-10-20T15:20'))).toBe('Fin du chargement notée à 15:20');
    expect(finishedText('livraison', new Date('2026-10-20T08:05'))).toBe('Fin de la livraison notée à 08:05');
  });
});
