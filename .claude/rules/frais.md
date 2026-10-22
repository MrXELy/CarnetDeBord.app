---
paths: ["src/lib/allowances.ts", "src/lib/allowances.test.ts", "src/components/Allowance*.tsx"]
---

# Frais de déplacement (`src/lib/allowances.ts`)

- Pastille des frais sous la semaine (icône et montant seulement, à côté de la pastille de la carte, icône seule ; ainsi les pastilles tiennent sur une ligne) (détail dans `AllowancesSheet.tsx`), tuile et section « Frais de route » dans les Statistiques (semaine, mois, année ; pas par jour).
- Bases et tarifs (avec date d'effet) dans les Options, enregistrés dans `user_settings` (migration 006), **jamais dans le code**.

## Règles validées sur les vraies semaines avec l'utilisateur

- Calcul par journée de travail d'après l'heure et le lieu des **débuts et fins de journée** seulement.
- Les repas à la base portent `meal: 'midi' | 'soir'` (lignes séparées sur la feuille de remboursement).
- Fin hors des bases → GD 2 repas + découcher si la journée couvre 11h45–14h15, sinon GD 1 repas. Fin à une base → repas midi (11h45–14h15) et soir (18h45–21h15).
- Casse-croûte : départ strictement avant 5h **et pas de découcher la veille** (sinon compris dans le GD).
- Repas unique de nuit : 4 h entre 22h et 7h, sans casse-croûte ni découcher la veille.
- Prime départ lundi : dimanche ≥ 22h ou lundi < 2h.
- Jour sans étape après un découcher (bloqué), compté quand la reprise est notée : GD 2 repas ; + prime bloqué le dimanche et les jours fériés (pas le samedi).
- Tarif étranger si la fin (GD) ou une étape du jour (repas) est hors de France.
- Tarifs de l'entreprise au 1er janvier 2026 par défaut ; prime bloqué à saisir. Pas de correction à la main pour l'instant.
