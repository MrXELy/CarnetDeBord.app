---
paths: ["src/lib/rest.ts", "src/lib/rest.test.ts", "src/components/RestNotice.tsx", "src/components/DayLimitNotice.tsx", "src/components/stats/RestSection.tsx", "src/lib/useNow.ts"]
---

# Repos RSE (règlement CE 561/2006, règles choisies avec l'utilisateur)

`src/lib/rest.ts` : contrôle de chaque début de journée (mémorisé dans `EventStore.restChecks()`), heure de reprise (`restartAdvice`), heure limite de la journée en cours (`dayLimit`), résumé d'une période (`restSummary`), rattrapages à faire (`openDebts`).

## Règles

- Repos = de la fin de journée au début suivant ; les pauses ne sont pas notées, donc **repos fractionné ignoré** (9 à 11 h = réduit).
- Journalier : 11 h, réduit 9 h, au plus 3 réduits entre deux repos hebdomadaires (le 3e en orange) ; **dans les 24 h** après le début de la journée d'avant (seule la part du repos dans ces 24 h compte : journée de 16 h → repos trop tard).
- Hebdomadaire = repos de 24 h et plus : 45 h, réduit 24 h ; pas deux réduits de suite, **sauf en international** si les deux sont hors de France (lieux de la fin et du début de journée), et alors pas plus de 2 réduits sur 4 repos ; manque (45 h − repos) à rattraper en une fois avant la fin de la 3e semaine (lundi–dimanche) qui suit, au-delà d'un repos normal (11 h ou 45 h) : rappel gris à chaque début de journée, rouge si en retard.
- Fin de journée oubliée : avertissement sans calcul ; étape notée pendant le repos ou journée de plus de 24 h : « vérifie ». Pas de règle des 6 jours (pas demandée).

## Affichage

- **Début de journée** : bandeau sous la date (`RestNotice.tsx`), recalculé en direct quand l'heure change, sans empêcher d'enregistrer : gris si correct (« Repos : 11 h 20 depuis la fin de journée la veille à 18:00 », repos réduit avec son rang « 2e sur 3 »), orange à surveiller, rouge en cas d'infraction. Sur la frise, petit triangle orange ou rouge sur le début de journée concerné.
- **Fin de journée** : même bandeau avec l'heure de reprise au plus tôt (11 h, ou 9 h avec un repos réduit et ceux qui restent ; repos hebdomadaire 45 h ou 24 h du vendredi au dimanche ; heure de reprise pour rattraper un repos réduit), et alerte si la journée dépasse 13 h (repos forcément réduit) ou 15 h.
- **Heure limite** sous le jour de la journée en cours (juste sous « Mardi 20 octobre », choix de l'utilisateur ; `DayLimitNotice.tsx`) tant qu'un début de journée de moins de 24 h n'a pas sa fin : « Fin de journée avant 18:00 pour 11 h de repos, avant 20:00 au plus tard (repos réduit, 2 restants sur 3) », orange dans la dernière heure, rouge après ; rafraîchie chaque minute (`useNow.ts`).
- **Section « Repos »** des Statistiques (semaine, mois, année) : repos journaliers et hebdomadaires (dont réduits), infractions, à vérifier, liste des alertes (toucher ouvre le jour), rattrapages à faire (période en cours).
