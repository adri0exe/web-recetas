import { supabase } from "./supabaseClient.js";

const titleEl = document.getElementById("recipe-title");
const summaryEl = document.getElementById("recipe-summary");
const dateEl = document.getElementById("recipe-date");
const metaEl = document.getElementById("recipe-meta");
const tagsEl = document.getElementById("recipe-tags");
const categoryEl = document.getElementById("recipe-category");
const imageEl = document.getElementById("recipe-image");
const ingredientsEl = document.getElementById("recipe-ingredients");
const stepsEl = document.getElementById("recipe-steps");

init();

async function init() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    titleEl.textContent = "Receta no encontrada";
    summaryEl.textContent = "Falta el identificador de la receta.";
    return;
  }
  await loadReceta(id);
}

async function loadReceta(id) {
  setLoadingState();
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
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      titleEl.textContent = "Receta no encontrada";
      summaryEl.textContent = "";
      return;
    }
    renderReceta(data);
  } catch (err) {
    console.error(err);
    titleEl.textContent = "No se pudo cargar la receta";
    summaryEl.textContent = err?.message || "Inténtalo de nuevo.";
  }
}

function renderReceta(receta) {
  titleEl.textContent = receta.titulo || "Receta";
  summaryEl.textContent = receta.resumen || "Sin descripcion";
  dateEl.textContent = `Publicada el ${formatFecha(receta.fecha)}`;
  renderMeta(receta);
  renderTags(receta);
  renderImage(receta);
  renderList(ingredientsEl, receta.ingredientes);
  renderList(stepsEl, receta.pasos, true);
}

function renderMeta(receta) {
  metaEl.innerHTML = "";
  const author = document.createElement("a");
  author.className = "author-chip";
  if (receta.user_id) {
    author.href = `profile-view.html?id=${encodeURIComponent(receta.user_id)}`;
  } else {
    author.href = "#";
  }
  const avatar = document.createElement("img");
  avatar.src = getAvatarUrl(receta.profiles);
  avatar.alt = receta.profiles?.username || "Autor";
  const name = document.createElement("span");
  name.textContent = receta.profiles?.username || "Autor";
  author.append(avatar, name);
  metaEl.appendChild(author);
}

function renderTags(receta) {
  tagsEl.innerHTML = "";
  if (categoryEl) {
    if (receta.categoria) {
      categoryEl.textContent = receta.categoria;
      categoryEl.hidden = false;
    } else {
      categoryEl.hidden = true;
    }
  }
  (receta.tags || []).forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    tagsEl.appendChild(chip);
  });
}

function renderImage(receta) {
  const url = receta.foto_url || receta.foto || null;
  if (url) {
    imageEl.src = url;
    imageEl.alt = `Foto de ${receta.titulo || "receta"}`;
    imageEl.hidden = false;
  } else {
    imageEl.hidden = true;
    imageEl.removeAttribute("src");
    imageEl.removeAttribute("alt");
  }
}

function renderList(target, items, ordered = false) {
  target.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const empty = document.createElement("li");
    empty.textContent = "Sin contenido";
    target.appendChild(empty);
    return;
  }
  list.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    target.appendChild(li);
  });
}

function getAvatarUrl(profile) {
  if (profile?.avatar_url) return profile.avatar_url;
  const seed = profile?.username || profile?.full_name || "user";
  const encoded = encodeURIComponent(seed);
  return `https://api.dicebear.com/6.x/initials/svg?seed=${encoded}&radius=50&backgroundColor=b6e3f4,c0aede,d1d4f9`;
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

function setLoadingState() {
  titleEl.textContent = "Cargando receta...";
  summaryEl.textContent = "";
  metaEl.innerHTML = "";
  ingredientsEl.innerHTML = "";
  stepsEl.innerHTML = "";
  tagsEl.innerHTML = "";
}
