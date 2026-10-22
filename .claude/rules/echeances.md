---
paths: ["src/lib/reminders.ts", "src/lib/reminders.test.ts", "src/components/HomeNotices.tsx", "src/components/ReminderSettings.tsx"]
---

# Échéances (Options, section « Échéances », colonne `user_settings.reminders`, migration 010)

- Ensemble routier principal (plaques du tracteur et de la remorque, montrées avec leurs contrôles techniques) et **date du dernier passage** de la carte conducteur (5 ans), FCO (5 ans), visite médicale (5, 2 ou 1 an au choix), CT du tracteur et de la remorque (1 an), étalonnage du chrono (2 ans) ; prochaine échéance calculée.
- Rappel en haut de l'accueil (`HomeNotices.tsx`, semaine en cours) : orange avant, rouge dépassée ; délai selon le document (carte et visite 2 mois, FCO 3 mois, CT et chrono 1 mois) ; toucher le texte ouvre les Options sur la section, l'horloge repousse le rappel d'une semaine (`snoozedUntil`, effacé par une nouvelle date).
- Sous-page « Échéances » des Options : une tuile par document (nom, « avant le … », délai court à droite ; « date à indiquer » en pointillés), touchée elle s'ouvre pour saisir le dernier passage ; elle prend la même couleur que le rappel (orange, rouge), même repoussée (`reminderLevel`). Les deux plus proches sont aussi en tuiles en haut des Options.
