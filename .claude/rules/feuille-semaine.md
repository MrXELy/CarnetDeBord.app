---
paths: ["src/lib/weekSheet.ts", "src/lib/weekSheet.test.ts", "src/lib/weekSheetPdf.ts", "src/components/WeekSheetSettings.tsx"]
---

# Feuille de semaine en PDF

`src/lib/weekSheet.ts` : contenu (calcul pur, testé) ; `src/lib/weekSheetPdf.ts` : dessin en PDF (jsPDF, importé à la demande).

- Case « Feuille » dans la page Semaine, à côté des cases des frais et de la carte. La feuille papier de l'entreprise (A3 pliée) redessinée, cadre bordeaux et données en bleu, 3 pages : page 1 en A4 (conducteur, tracteur, agence, semaine n° du lundi au samedi, départ de chaque jour : lieu et km du premier début de journée, départ du dimanche soir sur la ligne Dimanche), intérieur en A3 paysage (chargements et livraisons), page 4 en A4 paysage (carburant), puis page 5 en A4 : feuille de remboursement de frais (noir, voir plus bas). Partagée sur téléphone, téléchargée sur PC.
- Nom du conducteur, agence, matricule, date d'embauche et 5 colonnes « Dépôts » (titre + villes des pleins) dans les Options (`user_settings.week_sheet`, migration 009), **jamais dans le code**.

## Règles validées avec l'utilisateur sur ses semaines

- Lieux écrits « Ville (dép.) » sur toutes les pages, « Ville (pays) » hors de France. Logo `src/assets/logo.jpg` en haut à gauche des pages 1 et 5.
- Pages 2-3 : chaque chargement et chaque livraison est noté **au jour où il a lieu**, le jour écrit une seule fois. Un chargement ouvre une ligne (remorque, expéditeur, ville « Narbonne (11) », km, nature, poids, n° de LV) ; une livraison va sur la ligne de son chargement **du même jour** (par les LV, ou le dernier chargement du jour pour les anciennes étapes sans LV), sinon sur sa propre ligne avec la remorque, sans expéditeur (chargement d'un autre jour ou de la semaine d'avant : la livraison est quand même notée). Les livraisons suivantes d'une même ligne vont dessous, sans remorque.
- **Une ligne par LV** : un chargement de 2 LV prend 2 lignes (remorque, expéditeur, ville et km sur la première seulement), chacune avec la nature, le poids et le n° de sa LV ; une livraison du jour même va sur la ligne de sa LV ; une livraison d'un autre jour répète la nature, le poids et le n° de ses LV, une ligne par LV (remorque et destinataire sur la première). Un chargement non livré dans la semaine reste sans destinataire. Pas de « retours au dépôt ».
- Page 4 : départ = premier début de journée, arrivée et km de fin = dernière fin de journée, total km = fin − début ; un plein AS24 va en « AS 24 », DKV en « DKV » (à la place de « Shell »), les autres dans le dépôt de leur ville, sinon « Divers » ; croix « Plein OUI/NON » d'après « Plein complet » ; total des prises (gasoil seul). **Consommation jamais remplie.** Pas de logo en page 4.
- Page 5 (remboursement de frais) : matricule, nom, date d'embauche ; semaine n° du lundi au samedi. Chaque journée (début de journée + fin qui suit) sur la ligne du **jour de sa fin** : heure et ville du début, heure et ville de la fin ; un début la veille porte le nom de son jour en petit (« 21h15 lundi » sur la ligne Mardi). Plusieurs journées finies le même jour : premier début, dernière fin. Indemnités de la semaine (`allowances.ts`) : nombre à gauche, montant à droite (casse-croûte, repas midi, repas soir, GD 1 et 2 repas, repas de nuit) ; primes lundi et bloqué non reportées (pas de ligne sur la feuille). Autres frais vides, total général = total frais. Date de signature = dernière fin de journée de la semaine. Pas de signature.
