---
paths: ["src/lib/fuel.ts", "src/lib/fuel.test.ts", "src/components/stats/FuelSection.tsx"]
---

# Gasoil et consommation

- Interrupteur « Plein complet » sur l'étape carburant (colonne `full_tank`, migration 005), réglé d'office selon la station. Plein noté dans une ville de station Doumen (`DOUMEN_CITIES`) : Doumen choisi d'office si aucune station ne l'est encore.
- Conso calculée d'un plein complet au suivant par tracteur, compléments compris ; `fuelReport` donne pour une période le gasoil acheté et le gasoil consommé (km × conso de l'intervalle, ou conso habituelle des 4 derniers pleins si pas encore de plein). Affichée sur la carte du plein et dans les Options.
- **Choix** : jamais litres ÷ km d'une même semaine (compléments de 200-300 L, semaines sans plein). **Doumen = toujours plein complet**, AS24 et DKV = compléments (modifiable à la saisie ; anciennes étapes sans `full_tank` déduites de la station). Intervalle écarté si km ou litres manquants ou conso hors 15–50 L/100.
- Plaques comparées sans tirets ni espaces (`plateKey`), partout (km, conso, alerte de km).
