// scripts/generate_all_images.mjs
import { createClient } from "@supabase/supabase-js";

console.log("SCRIPT START");

// ====== CONFIG ======
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY; // tu secret service role REAL
const EDGE_FUNCTION_URL =
  process.env.EDGE_FUNCTION_URL ||
  "https://qooglpugptjfgitndkdz.functions.supabase.co/generate-recipe-image";

// Para pasar el gateway (apikey/authorization). Puedes usar ANON o SERVICE_ROLE.
// Recomiendo ANON para el gateway, y SERVICE_ROLE para leer BD.
const GATEWAY_KEY = process.env.SUPABASE_ANON_KEY || process.env.SERVICE_ROLE_KEY;

// Lotes y concurrencia
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 50);
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);

// Reintentos (si HF está cargando o hay 5xx)
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 4);
const BASE_DELAY_MS = Number(process.env.BASE_DELAY_MS || 2000);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !GATEWAY_KEY) {
  console.error("Faltan variables de entorno. Necesitas:");
  console.error("SUPABASE_URL, SERVICE_ROLE_KEY, y SUPABASE_ANON_KEY (o usa SERVICE_ROLE_KEY como gateway)");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ====== helpers ======
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callEdgeFunction(receta_id, force = false) {
  const res = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: GATEWAY_KEY,
      Authorization: `Bearer ${GATEWAY_KEY}`,
    },
    body: JSON.stringify({ receta_id, force }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: res.status, body: json };
}

function shouldRetryFromResponse(status, body) {
  // 502 de HF, 500 temporales, 429 rate limit, 503 loading
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  // Algunos mensajes típicos de HF "loading"
  const detail = (body?.detail || body?.error || "").toString().toLowerCase();
  if (detail.includes("loading") || detail.includes("currently loading")) return true;

  return false;
}

async function generateOne(receta_id) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { status, body } = await callEdgeFunction(receta_id, false);

    if (status === 200 && (body.status === "ready" || body.status === "exists")) {
      return { ok: true, status: body.status, publicUrl: body.publicUrl };
    }

    if (status === 200 && body.status === "pending") {
      // Tu función puede devolver pending por TTL; esperamos un poco y reintentamos
      if (attempt === MAX_RETRIES) return { ok: false, reason: "pending_timeout" };
      await sleep(BASE_DELAY_MS * (attempt + 1));
      continue;
    }

    // errores recuperables
    if (shouldRetryFromResponse(status, body) && attempt < MAX_RETRIES) {
      const wait = BASE_DELAY_MS * Math.pow(2, attempt); // backoff exponencial
      console.warn(`↻ retry receta ${receta_id} (status ${status}) wait ${wait}ms`, body?.detail || body?.error || "");
      await sleep(wait);
      continue;
    }

    // error definitivo
    return { ok: false, reason: `http_${status}`, body };
  }
  return { ok: false, reason: "unknown" };
}

async function fetchPage(offset) {
  // Trae recetas sin foto_url
  const { data, error } = await supabaseAdmin
    .from("recetas")
    .select("id")
    .is("foto_url", null)
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw error;
  return data || [];
}

async function runPool(items, workerFn, concurrency) {
  let idx = 0;
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      results.push(await workerFn(current));
    }
  });
  await Promise.all(workers);
  return results;
}

// ====== main ======
(async () => {
  console.log("EDGE:", EDGE_FUNCTION_URL);
  console.log("PAGE_SIZE:", PAGE_SIZE, "CONCURRENCY:", CONCURRENCY, "MAX_RETRIES:", MAX_RETRIES);

  let offset = 0;
  let totalProcessed = 0;
  let totalOk = 0;
  let totalFail = 0;

  while (true) {
    const page = await fetchPage(offset);
    if (page.length === 0) break;

    console.log(`\n📦 Page offset ${offset} -> ${page.length} recetas sin foto_url`);

    const ids = page.map((r) => r.id);

    const results = await runPool(
      ids,
      async (id) => {
        const r = await generateOne(id);
        if (r.ok) {
          console.log(`✅ ${id} -> ${r.status}`);
          return { id, ...r };
        } else {
          console.error(`❌ ${id} -> ${r.reason}`, r.body?.detail || r.body?.error || "");
          return { id, ...r };
        }
      },
      CONCURRENCY
    );

    totalProcessed += results.length;
    totalOk += results.filter((r) => r.ok).length;
    totalFail += results.filter((r) => !r.ok).length;

    console.log(`Resumen parcial: processed=${totalProcessed} ok=${totalOk} fail=${totalFail}`);

    offset += PAGE_SIZE;

    // pausa pequeña entre páginas para no saturar
    await sleep(500);
  }

  console.log("\n✅ FIN");
  console.log({ totalProcessed, totalOk, totalFail });
})();
