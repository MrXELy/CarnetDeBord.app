---
paths: ["src/lib/demoData.ts", "src/lib/demoData.test.ts", "src/components/Settings.tsx"]
---

# Mode démo

Ajouter `?demo` à l'adresse (seulement en développement). Il lit `data/demo-events.json` et ne contacte pas Supabase ; `?demo=reset` recharge les données. Les changements faits en démo restent dans le navigateur (par adresse : localhost et 192.168… sont séparés) ; « Sauvegarder la démo » (Options, mode démo) télécharge étapes, LV et réglages (sans photos) au format `{ events, waybills, settings }`, à mettre à la place de `data/demo-events.json` (l'ancien format, la liste des étapes seule, est encore lu ; le client et le n° de LV notés sur ses étapes deviennent des LV : `legacyWaybills`). En démo, lecture des LV simulée ; photos sous `demo/…`, jamais envoyées ni effacées du serveur.
