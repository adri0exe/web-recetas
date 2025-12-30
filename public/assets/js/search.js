import { supabase } from "./supabaseClient.js";

const resultsEl = document.getElementById("search-results");
const titleEl = document.getElementById("results-title");

init();

async function init() {
  const term = (new URLSearchParams(window.location.search).get("q") || "").trim();
  if (!term) {
    titleEl.textContent = "Escribe algo para buscar";
    resultsEl.innerHTML = "<p class='muted'>No hay termino de busqueda.</p>";
    return;
  }
  titleEl.textContent = `Buscando: ${term}`;
  await searchRecetas(term);
}

async function searchRecetas(term) {
  resultsEl.innerHTML = "<p class='muted'>Cargando resultados...</p>";
  try {
    // Búsqueda fuzzy en BD (pg_trgm) vía RPC: requiere función search_recetas(lim, q)
    const { data, error } = await supabase.rpc("search_recetas", {
      q: term.toLowerCase(),
      lim: 50,
    });
    if (error) throw error;
    const resultados = Array.isArray(data) ? data : [];
    if (resultados.length) {
      renderResults(resultados);
      return;
    }
    // Fallback cliente si la RPC no devuelve nada
    await fallbackSearch(term);
  } catch (err) {
    console.error("No se pudieron cargar los resultados", err);
    resultsEl.innerHTML = "<p class='muted'>No se pudieron cargar los resultados. Intentalo de nuevo.</p>";
  }
}

async function fallbackSearch(term) {
  const query = term.trim();
  if (!query) {
    resultsEl.innerHTML = "<p class='muted'>No hay resultados.</p>";
    return;
  }

  const { data, error } = await supabase
    .from("recetas")
    .select(
      `
      id,
      titulo,
      resumen,
      fecha,
      categoria,
      tags,
      ingredientes,
      pasos,
      user_id,
      profiles:profiles (
        username
      )
    `
    )
    .order("fecha", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Fallback search error", error);
    resultsEl.innerHTML = "<p class='muted'>No se pudieron cargar los resultados. Intentalo de nuevo.</p>";
    return;
  }

  const filtradas = (data || []).filter((receta) => matchesSearch(receta, query));
  renderResults(filtradas);
}

function renderResults(recetas) {
  if (!recetas.length) {
    resultsEl.innerHTML = "<p class='muted'>No hay resultados.</p>";
    return;
  }
  resultsEl.innerHTML = "";
  recetas.forEach((receta) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const link = document.createElement("a");
    link.href = `recipe-view.html?id=${encodeURIComponent(receta.id)}`;

    const title = document.createElement("h3");
    title.textContent = receta.titulo;

    const summary = document.createElement("p");
    summary.className = "muted";
    summary.textContent = receta.resumen || "Sin descripcion";

    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = formatMeta(receta);

    link.append(title, summary, meta);
    card.append(link);
    resultsEl.appendChild(card);
  });
}

function formatMeta(receta) {
  const fecha = formatFecha(receta.fecha);
  const autor =
    receta?.username || receta?.profiles?.username ? ` · ${receta.username || receta?.profiles?.username}` : "";
  return `${fecha}${autor}`;
}

function matchesSearch(receta, term) {
  const query = normalizeText(term);
  const titulo = normalizeText(receta.titulo);
  const resumen = normalizeText(receta.resumen);
  const ingredientes = normalizeText((receta.ingredientes || []).join(" "));
  const pasos = normalizeText((receta.pasos || []).join(" "));
  const categoria = normalizeText(receta.categoria);
  const tags = normalizeText((receta.tags || []).join(" "));

  if (
    titulo.includes(query) ||
    resumen.includes(query) ||
    ingredientes.includes(query) ||
    pasos.includes(query) ||
    categoria.includes(query) ||
    tags.includes(query)
  ) {
    return true;
  }

  const fieldTokens = tokenize([titulo, resumen, ingredientes, pasos, categoria, tags].join(" "));
  const queryTokens = tokenize(term).filter((t) => t.length > 2);
  if (!queryTokens.length) return false;
  return queryTokens.every((token) => fuzzyTokenMatch(token, fieldTokens));
}

function normalizeText(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9ñ]/gi, ""))
    .filter(Boolean);
}

function fuzzyTokenMatch(token, fieldTokens) {
  if (!fieldTokens.length) return false;
  if (fieldTokens.some((t) => t.includes(token))) return true;
  const minDistance = fieldTokens.reduce((min, t) => Math.min(min, levenshtein(token, t)), Infinity);
  const threshold = token.length <= 5 ? 1 : 2;
  return minDistance <= threshold;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // delete
        dp[i][j - 1] + 1, // insert
        dp[i - 1][j - 1] + cost // replace
      );
    }
  }
  return dp[m][n];
}

function formatFecha(fecha) {
  const date = fecha ? new Date(fecha) : new Date();
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
