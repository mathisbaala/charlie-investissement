import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Initialisation paresseuse : on ne crée le client qu'au premier accès réel
// (au moment de la requête), jamais au chargement du module. Cela évite que le
// build Next.js (phase « Collecting page data ») n'instancie le client alors que
// les variables d'environnement peuvent être absentes — notamment sur les
// déploiements preview Vercel, où SUPABASE_URL n'est pas injectée.
let client: SupabaseClient | null = null;

// Garde-temps réseau : une requête PostgREST qui gèle (contention CPU Supabase,
// verrou, socket pendante) ne doit pas bloquer indéfiniment la route serverless.
// On avorte au-delà de ce délai — plus large que le statement_timeout SQL, donc
// c'est un vrai filet de dernier recours, pas un couperet sur les requêtes lentes
// légitimes. Le signal éventuel de l'appelant est préservé (course des deux).
const FETCH_TIMEOUT_MS = 18_000;

const timedFetch: typeof fetch = (input, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const caller = init?.signal;
  if (caller) {
    if (caller.aborted) ctrl.abort();
    else caller.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer),
  );
};

function getClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies",
    );
  }

  client = createClient(supabaseUrl, supabaseKey, {
    global: { fetch: timedFetch },
  });
  return client;
}

// On expose toujours `supabase` comme une constante : un Proxy transmet chaque
// accès au vrai client, créé à la demande. Les sites d'appel restent inchangés
// (`supabase.from(...)`, `supabase.rpc(...)`, etc.).
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getClient();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
