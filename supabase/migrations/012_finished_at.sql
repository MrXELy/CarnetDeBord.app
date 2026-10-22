-- CarnetDeBord.app : heure de fin des chargements et livraisons (bouton « Fin du chargement »),
-- pour connaître le temps passé chez chaque client. L'heure de l'étape reste l'heure d'arrivée.
-- À coller dans Supabase → SQL Editor, puis « Run ». Peut être relancé sans risque.
-- À lancer AVANT de mettre l'appli en ligne : sinon le serveur refuse les étapes envoyées.

alter table public.events add column if not exists finished_at timestamptz;
