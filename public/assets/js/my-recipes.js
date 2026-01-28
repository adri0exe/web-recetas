import { supabase } from "./supabaseClient.js";

const recetasContainer = document.getElementById("recetas");
const template = document.getElementById("receta-template");
const searchInput = document.getElementById("search-receta");
const pagination = document.getElementById("pagination");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");

let recetas = [];
let currentSession = null;
let isAdmin = false;
let searchTerm = "";
let currentPage = 1;
const pageSize = 5;

init();

async function init() {
  attachListeners();
  await ensureSession();
  await loadUserRole();
  await syncRecetas();
}

function attachListeners() {
  searchInput.addEventListener("input", handleSearch);
  prevPageBtn.addEventListener("click", () => changePage(-1));
  nextPageBtn.addEventListener("click", () => changePage(1));

  recetasContainer.addEventListener("click", async (event) => {
    const featuredBtn = event.target.closest("[data-accion='destacada']");
    if (featuredBtn) {
      if (!isAdmin) return;
      const id = featuredBtn.dataset.id;
      if (!id) return;
      await toggleDestacada(id, featuredBtn);
      return;
    }

    const card = event.target.closest(".receta");
    if (!card || event.target.closest("button") || event.target.closest("a")) return;
    const id = card.dataset.id;
    if (!id) return;
    window.location.href = `recipe-view.html?id=${encodeURIComponent(id)}`;
  });
}

async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  currentSession = data?.session || null;
  if (!currentSession) {
    window.location.href = "auth.html";
    return;
  }
}

async function syncRecetas() {
  recetasContainer.innerHTML = '<p class="muted">Cargando tus recetas...</p>';
  try {
    const { data, error } = await supabase
      .from("recetas")
      .select(
        `
        *,
        profiles:profiles (
          username,
          full_name,
          avatar_url
        )
      `
      )
      .eq("user_id", currentSession.user.id)
      .order("fecha", { ascending: false });
    if (error) throw error;
    recetas = data || [];
    currentPage = 1;
    renderRecetas();
  } catch (err) {
    console.error("No se pudieron cargar tus recetas", err);
    recetasContainer.innerHTML =
      '<p class="empty">No se pudieron cargar tus recetas. Comprueba tu conexi\u00f3n.</p>';
  }
}

function renderRecetas() {
  recetasContainer.innerHTML = "";

  const filtradas = filterRecetas(recetas, searchTerm);

  if (!filtradas.length) {
    recetasContainer.innerHTML = '<p class="empty">No has publicado recetas todav\u00eda.</p>';
    pagination.hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtradas.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * pageSize;
  const paginadas = filtradas.slice(start, start + pageSize);

  paginadas.forEach((receta) => {
    const clone = template.content.cloneNode(true);
    const titleEl = clone.querySelector(".receta-title");
    const imgEl = clone.querySelector(".receta-img");
    const metaEl = clone.querySelector(".receta-meta-text");
    const starBtn = clone.querySelector(".star-btn");
    const featuredBtn = clone.querySelector(".featured-toggle");
    const card = clone.querySelector(".receta");

    titleEl.textContent = receta.titulo;
    metaEl.textContent = `${formatFecha(receta.fecha)} - `;
    if (receta.user_id) {
      const link = document.createElement("a");
      link.href = `profile-view.html?id=${encodeURIComponent(receta.user_id)}`;
      link.className = "author-link";
      link.textContent = displayAuthor(receta);
      metaEl.appendChild(link);
    } else {
      metaEl.appendChild(document.createTextNode(displayAuthor(receta)));
    }

    if (starBtn) {
      starBtn.textContent = "\u2606";
      starBtn.disabled = true;
    }

    if (featuredBtn) {
      featuredBtn.dataset.id = receta.id;
      featuredBtn.hidden = !isAdmin;
      featuredBtn.classList.toggle("hidden", !isAdmin);
      setFeaturedButtonState(featuredBtn, Boolean(receta.destacada));
    }
    if (card) card.dataset.id = receta.id;

    const fotoUrl = receta.foto_url || receta.foto || null;
    if (fotoUrl) {
      imgEl.src = fotoUrl;
      imgEl.alt = `Foto de ${receta.titulo}`;
      imgEl.hidden = false;
    } else {
      imgEl.hidden = true;
    }

    recetasContainer.appendChild(clone);
  });

  pagination.hidden = false;
  pageInfo.textContent = `P\u00e1gina ${currentPage} de ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function handleSearch(event) {
  searchTerm = (event.target.value || "").trim().toLowerCase();
  currentPage = 1;
  renderRecetas();
}

function filterRecetas(lista, term) {
  if (!term) return lista;
  const query = normalizeText(term);
  return lista.filter((receta) => {
    const titulo = normalizeText(receta.titulo);
    const resumen = normalizeText(receta.resumen);
    const ingredientes = normalizeText((receta.ingredientes || []).join(" "));
    const pasos = normalizeText((receta.pasos || []).join(" "));
    const categoria = normalizeText(receta.categoria);
    const tags = normalizeText((receta.tags || []).join(" "));
    return (
      titulo.includes(query) ||
      resumen.includes(query) ||
      ingredientes.includes(query) ||
      pasos.includes(query) ||
      categoria.includes(query) ||
      tags.includes(query)
    );
  });
}

function normalizeText(value) {
  return (value || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function changePage(delta) {
  currentPage = Math.max(1, currentPage + delta);
  renderRecetas();
  scrollToRecetasTop();
}

function scrollToRecetasTop() {
  if (recetasContainer?.scrollIntoView) {
    recetasContainer.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function toggleDestacada(id, btn) {
  try {
    btn.disabled = true;
    const receta = recetas.find((r) => r.id === id);
    const nextValue = !receta?.destacada;
    const { error } = await supabase.from("recetas").update({ destacada: nextValue }).eq("id", id);
    if (error) throw error;
    if (receta) receta.destacada = nextValue;
    setFeaturedButtonState(btn, nextValue);
  } catch (err) {
    console.error(err);
    alert("No se pudo actualizar destacada. Intentalo de nuevo.");
  } finally {
    btn.disabled = false;
  }
}




function displayAuthor(receta) {
  const p = receta?.profiles;
  if (!p) return "Tu";
  return p.username || "Tu";
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

async function loadUserRole() {
  try {
    const role = await getMyRole();
    isAdmin = role === "admin";
  } catch (err) {
    console.warn("No se pudo cargar el rol del usuario", err);
    isAdmin = false;
  }
}

async function getMyRole() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("No se pudo cargar el rol:", error);
    return null;
  }
  return data?.role ?? null;
}

function setFeaturedButtonState(btn, isFeatured) {
  if (!btn) return;
  btn.textContent = isFeatured ? "Quitar destacada" : "Destacar";
  btn.classList.toggle("is-featured", isFeatured);
  btn.setAttribute("aria-pressed", isFeatured ? "true" : "false");
}







