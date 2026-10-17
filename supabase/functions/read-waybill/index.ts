// Lecture automatique d'une photo de lettre de voiture avec Claude.
// Lecture économique par défaut : Claude Haiku 5.5 (imprimé comme manuscrit).
// « Relire en mode fiable » : Claude Opus 5.5.
//
// Garde-fous (imposés ici, côté serveur, même si l'appli a un bug) :
//   - 2 lectures maximum par photo, 30 par jour, 300 par mois et par utilisateur ;
//   - chaque tentative est enregistrée AVANT l'appel à Claude ;
//   - max_tokens limité (coût par appel plafonné), une seule nouvelle tentative du SDK, 60 s maximum.
//
// Déploiement : npx supabase functions deploy read-waybill --project-ref <projet>
// Clé : npx supabase secrets set ANTHROPIC_API_KEY=... --project-ref <projet>

import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

// « printed » : lecture économique (~40 fois moins chère), par défaut. « handwritten » : la plus fiable.
const MODELS = {
  printed: 'claude-haiku-5-5',
  handwritten: 'claude-opus-5-5',
} as const;
type Mode = keyof typeof MODELS;
const MAX_TOKENS = 1500;
const LIMIT_PER_PHOTO = 2;
const LIMIT_PER_DAY = 30;
const LIMIT_PER_MONTH = 300;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// Tarifs en $ par million de jetons (entrée, sortie), pour estimer le coût de chaque lecture.
const RATES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-opus-5-5': [4, 20],
  'claude-opus-4-8': [5, 25],
};
const DEFAULT_RATE: [number, number] = [5, 25];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM = `Tu lis des photos de lettres de voiture françaises (transport routier de marchandises), de n'importe quel format : formulaires pré-imprimés remplis à la main, ou documents entièrement imprimés.

Extrais uniquement ce qui est réellement écrit sur le document :
- number : le numéro de la lettre de voiture, chiffres et lettres sans espaces, en gardant les zéros de tête. Il est imprimé en haut (« N° », ou à côté du logo CMR sur une lettre internationale). Ce n'est pas un numéro de mission, de bon de livraison (« Delivery Note », « BL »), de commande ni de code-barres.
- shipper_* : l'expéditeur / remettant (case « Expéditeur », case 1 d'une CMR). Ce n'est PAS le transporteur dont le logo ou l'en-tête figure sur le formulaire (par exemple Doumen), ni le donneur d'ordres s'il est distinct. Si le nom est écrit à la main et qu'un tampon donne la raison sociale complète, prends le nom écrit à la main.
- consignee_* : le destinataire (case « Destinataire », case 2 d'une CMR). Si le nom tient sur plusieurs lignes, réunis-les (ex. « Chantier France Travail SPE »).
- consignee_city / consignee_department : la ville où la marchandise est livrée. Sur une CMR, prends le « Lieu prévu pour la livraison » (case 3) s'il est rempli, sinon l'adresse du destinataire.
- *_city : la ville seule, sans numéro de département, code postal, « CEDEX » ni numéro de rue.
- *_department : le numéro de département français (ex. « 19 », « 2A ») s'il est écrit ou déductible du code postal ; sinon null.
- goods : la nature de la marchandise avec la quantité, en une ligne courte (80 caractères maximum). Une seule ligne : recopie-la telle qu'écrite (ex. « 9 pal eurocoustic »). Plusieurs lignes : résume avec le total des quantités par unité et la nature générale (ex. « 21 pal + 40 pc plaques de plâtre et rails »).
- weight_kg : le poids brut TOTAL en kilogrammes. S'il y a une ligne de total, prends-la plutôt que d'additionner. Attention à la virgule décimale française : « 2,628t » → 2628 ; « 12 712 kg » → 12712 ; « 27 168,276 KG » → 27168.276.

Si une information est absente, illisible ou incertaine, mets null : n'invente jamais rien. Si la photo montre d'autres papiers autour de la lettre, ignore-les.`;

const nullable = (type: 'string' | 'number') => ({ type: [type, 'null'] });
const SCHEMA = {
  type: 'object',
  properties: {
    number: nullable('string'),
    shipper_name: nullable('string'),
    shipper_city: nullable('string'),
    shipper_department: nullable('string'),
    consignee_name: nullable('string'),
    consignee_city: nullable('string'),
    consignee_department: nullable('string'),
    goods: nullable('string'),
    weight_kg: nullable('number'),
  },
  required: [
    'number',
    'shipper_name',
    'shipper_city',
    'shipper_department',
    'consignee_name',
    'consignee_city',
    'consignee_department',
    'goods',
    'weight_kg',
  ],
  additionalProperties: false,
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const authorization = req.headers.get('Authorization') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1. Utilisateur connecté, et photo dans son propre dossier.
  const { data: auth } = await asUser.auth.getUser();
  const user = auth.user;
  if (!user) return reply(401, { error: 'Non connecté' });

  const body = (await req.json().catch(() => ({}))) as { path?: unknown; mode?: unknown };
  const path = body.path;
  if (typeof path !== 'string' || !new RegExp(`^${user.id}/[\\w-]+/[\\w-]+\\.jpg$`).test(path)) {
    return reply(400, { error: 'Photo invalide' });
  }
  // Lecture économique par défaut ; le modèle le plus fiable seulement s'il est demandé.
  const mode: Mode = body.mode === 'handwritten' ? 'handwritten' : 'printed';

  // 2. Limites, vérifiées avant toute dépense.
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const count = async (filter: (q: any) => any) => {
    const { count, error } = await filter(
      admin.from('ocr_usage').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    );
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  try {
    if ((await count((q) => q.eq('photo_path', path))) >= LIMIT_PER_PHOTO) {
      return reply(429, { error: `Cette photo a déjà été lue ${LIMIT_PER_PHOTO} fois.` });
    }
    if ((await count((q) => q.gte('created_at', dayStart))) >= LIMIT_PER_DAY) {
      return reply(429, { error: `Limite de ${LIMIT_PER_DAY} lectures par jour atteinte.` });
    }
    if ((await count((q) => q.gte('created_at', monthStart))) >= LIMIT_PER_MONTH) {
      return reply(429, { error: `Limite de ${LIMIT_PER_MONTH} lectures par mois atteinte.` });
    }
  } catch (err) {
    return reply(500, { error: `Suivi des lectures indisponible : ${String(err)}` });
  }

  // 3. La tentative est enregistrée avant l'appel : elle compte même si la suite échoue.
  const { data: row, error: insertError } = await admin
    .from('ocr_usage')
    .insert({ user_id: user.id, photo_path: path, model: MODELS[mode] })
    .select('id')
    .single();
  if (insertError) return reply(500, { error: insertError.message });
  const finish = (fields: Record<string, unknown>) => admin.from('ocr_usage').update(fields).eq('id', row.id);

  try {
    // 4. Photo, téléchargée avec les droits de l'utilisateur.
    const { data: blob, error: downloadError } = await asUser.storage.from('waybill-photos').download(path);
    if (downloadError || !blob) throw new Error('Photo introuvable dans le stockage');
    if (blob.size > MAX_PHOTO_BYTES) throw new Error('Photo trop lourde');
    const data = encodeBase64(new Uint8Array(await blob.arrayBuffer()));

    // 5. Lecture par Claude.
    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), maxRetries: 1, timeout: 60_000 });
    const response = await client.beta.messages.create({
      model: MODELS[mode],
      max_tokens: MAX_TOKENS,
      // Repli en cas de refus : disponible pour le modèle principal seulement (pas pour Haiku).
      ...(mode === 'handwritten'
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: 'Lis cette lettre de voiture.' },
          ],
        },
      ],
    });

    const [inRate, outRate] = RATES[response.model] ?? DEFAULT_RATE;
    const usage = {
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_usd: (response.usage.input_tokens * inRate + response.usage.output_tokens * outRate) / 1_000_000,
    };

    if (response.stop_reason === 'refusal') throw Object.assign(new Error('Lecture refusée par le modèle'), { usage });
    if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('Réponse incomplète'), { usage });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw Object.assign(new Error('Réponse vide'), { usage });
    const reading = JSON.parse(text.text);

    await finish({ status: 'ok', ...usage });
    return reply(200, { reading, cost_usd: usage.cost_usd });
  } catch (err) {
    const usage = (err as { usage?: Record<string, unknown> }).usage ?? {};
    await finish({ status: 'erreur', ...usage });
    const message =
      err instanceof Anthropic.RateLimitError
        ? 'Service de lecture saturé, réessaie plus tard'
        : err instanceof Anthropic.AuthenticationError
          ? 'Clé API Anthropic invalide'
          : err instanceof Anthropic.APIError
            ? `Erreur du service de lecture (${err.status})`
            : err instanceof Error
              ? err.message
              : 'Erreur inconnue';
    return reply(502, { error: message });
  }
});
