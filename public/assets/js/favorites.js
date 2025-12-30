import { supabase } from "./supabaseClient.js";

const recetasContainer = document.getElementById("recetas");
const template = document.getElementById("receta-template");
const lightbox = document.getElementById("image-lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const closeLightboxBtn = document.getElementById("close-lightbox");
const searchInput = document.getElementById("search-receta");
const pagination = document.getElementById("pagination");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmAccept = document.getElementById("confirm-accept");

let recetas = [];
let currentSession = null;
let searchTerm = "";
let currentPage = 1;
const pageSize = 5;

init();

async function init() {
  attachListeners();
  await ensureSession();
  await syncRecetas();
}

function attachListeners() {
  closeLightboxBtn.addEventListener("click", hideLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) hideLightbox();
  });
  searchInput.addEventListener("input", handleSearch);
  prevPageBtn.addEventListener("click", () => changePage(-1));
  nextPageBtn.addEventListener("click", () => changePage(1));

  recetasContainer.addEventListener("click", async (event) => {
    const img = event.target.closest(".receta-img");
    if (img && img.dataset.full) {
      showLightbox(img.dataset.full, img.alt || "Foto de la receta");
      return;
    }

    const starBtn = event.target.closest("[data-accion='favorita']");
    if (starBtn) {
      const id = starBtn.dataset.id;
      if (!id) return;
      const esFavorita = true; // en esta lista ya vienen favoritas
      const ok = await showConfirmModal(
        "Eliminar de favoritos?",
        "Eliminar"
      );
      if (!ok) return;
      await toggleFavorita(id, starBtn);
      return;
    }
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
  recetasContainer.innerHTML = '<p class="muted">Cargando favoritas...</p>';
  try {
    const { data, error } = await supabase
      .from("favorites")
      .select(
        `
        receta:recetas (
          *,
          profiles:profiles (
            username,
            full_name,
            avatar_url
          )
        )
      `
      )
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    recetas = (data || [])
      .map((row) => row.receta)
      .filter(Boolean)
      .map((r) => ({ ...r, favorita: true }));
    currentPage = 1;
    renderRecetas();
  } catch (err) {
    console.error("No se pudieron cargar las favoritas", err);
    recetasContainer.innerHTML =
      '<p class="empty">No se pudieron cargar las favoritas. Comprueba tu conexiÃ³n.</p>';
  }
}

function renderRecetas() {
  recetasContainer.innerHTML = "";

  const filtradas = filterRecetas(recetas, searchTerm);

  if (!filtradas.length) {
    recetasContainer.innerHTML = '<p class="empty">No hay recetas favoritas todavÃ­a.</p>';
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
    const summaryEl = clone.querySelector(".receta-summary");
    const imgEl = clone.querySelector(".receta-img");
    const ingredientesEl = clone.querySelector(".ingredientes");
    const pasosEl = clone.querySelector(".pasos");
    const metaEl = clone.querySelector(".receta-meta-text");
    const starBtn = clone.querySelector(".star-btn");
    const editBtn = clone.querySelector(".edit-btn");
    const deleteBtn = clone.querySelector(".delete-btn");

    titleEl.textContent = receta.titulo;
    summaryEl.textContent = receta.resumen || "Sin descripciÃ³n";
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

    starBtn.dataset.id = receta.id;
    const favorita = Boolean(receta.favorita);
    starBtn.textContent = favorita ? "\u2605" : "\u2606";
    starBtn.classList.toggle("starred", favorita);

    // Ocultar ediciÃ³n/eliminaciÃ³n aquÃ­; se editan desde la pantalla principal
    editBtn.classList.add("hidden");
    editBtn.hidden = true;
    deleteBtn.classList.add("hidden");
    deleteBtn.hidden = true;

    const fotoUrl = receta.foto_url || receta.foto || null;
    if (fotoUrl) {
      imgEl.src = fotoUrl;
      imgEl.alt = `Foto de ${receta.titulo}`;
      imgEl.dataset.full = fotoUrl;
      imgEl.hidden = false;
    } else {
      imgEl.hidden = true;
    }

    ingredientesEl.innerHTML = "";
    (receta.ingredientes || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      ingredientesEl.appendChild(li);
    });

    pasosEl.innerHTML = "";
    (receta.pasos || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      pasosEl.appendChild(li);
    });

    const categoriaBadge = clone.querySelector(".category-badge");
    if (receta.categoria) {
      categoriaBadge.textContent = receta.categoria;
      categoriaBadge.hidden = false;
    } else {
      categoriaBadge.hidden = true;
    }

    const tagsWrap = clone.querySelector(".receta-tags");
    tagsWrap.innerHTML = "";
    (receta.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      tagsWrap.appendChild(chip);
    });

    recetasContainer.appendChild(clone);
  });

  pagination.hidden = false;
  pageInfo.textContent = `PÃ¡gina ${currentPage} de ${totalPages}`;
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
    .replace(/[\\u0300-\\u036f]/g, "");
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

async function toggleFavorita(id, btn) {
  try {
    btn.disabled = true;
    // En esta pantalla todas son favoritas; eliminamos de favorites
    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", currentSession.user.id)
      .eq("receta_id", id);
    if (error) throw error;
    recetas = recetas.filter((r) => r.id !== id);
    renderRecetas();
  } catch (err) {
    console.error(err);
    alert("No se pudo actualizar favorito. Inténtalo de nuevo.");
  } finally {
    btn.disabled = false;
  }
}
function showConfirmModal(message, acceptLabel = "Aceptar") {
  return new Promise((resolve) => {
    if (!confirmOverlay || !confirmMessage || !confirmCancel || !confirmAccept) {
      const fallback = window.confirm(message || "");
      resolve(fallback);
      return;
    }
    confirmMessage.textContent = message || "Eliminar de favoritos?";
    confirmAccept.textContent = acceptLabel || "Aceptar";
    confirmOverlay.style.display = "flex";

    const cleanup = () => {
      confirmOverlay.style.display = "none";
      confirmCancel.removeEventListener("click", onCancel);
      confirmAccept.removeEventListener("click", onAccept);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onAccept = () => {
      cleanup();
      resolve(true);
    };

    confirmCancel.addEventListener("click", onCancel, { once: true });
    confirmAccept.addEventListener("click", onAccept, { once: true });
  });
}

function displayAuthor(receta) {
  const p = receta?.profiles;
  if (!p) return "Autor desconocido";
  return p.username || "Autor";
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

function showLightbox(url, alt) {
  lightboxImg.src = url;
  lightboxImg.alt = alt || "Foto de receta";
  lightbox.classList.remove("hidden");
}

function hideLightbox() {
  lightbox.classList.add("hidden");
  lightboxImg.removeAttribute("src");
  lightboxImg.removeAttribute("alt");
}








