import { supabase } from "./supabaseClient.js";

const avatarEl = document.getElementById("public-avatar");
const usernameEl = document.getElementById("public-username");
const nameEl = document.getElementById("public-name");
const bioEl = document.getElementById("public-bio");
const recipesEl = document.getElementById("public-recipes");

init();

async function init() {
  const userId = new URLSearchParams(window.location.search).get("id");
  if (!userId) {
    recipesEl.innerHTML = "<p class='muted'>Perfil no encontrado.</p>";
    return;
  }
  await loadProfile(userId);
  await loadRecipes(userId);
}

async function loadProfile(id) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("username, full_name, bio, avatar_url")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      usernameEl.textContent = "Perfil no encontrado";
      return;
    }
    usernameEl.textContent = data.username || "Usuario";
    nameEl.textContent = data.full_name || "";
    bioEl.textContent = data.bio || "Sin biografia";
    avatarEl.src = getAvatarUrl(data);
    avatarEl.alt = data.username || "Avatar";
  } catch (err) {
    console.error(err);
    usernameEl.textContent = "No se pudo cargar el perfil";
  }
}

async function loadRecipes(userId) {
  recipesEl.innerHTML = "<p class='muted'>Cargando recetas...</p>";
  try {
    const { data, error } = await supabase
      .from("recetas")
      .select("id, titulo, resumen, fecha")
      .eq("user_id", userId)
      .order("fecha", { ascending: false });
    if (error) throw error;
    const recetas = data || [];
    if (!recetas.length) {
      recipesEl.innerHTML = "<p class='muted'>No hay recetas publicadas.</p>";
      return;
    }
    recipesEl.innerHTML = "";
    recetas.forEach((receta) => {
      const card = document.createElement("article");
      card.className = "recipe-card";
      const link = document.createElement("a");
      link.href = `recipe-view.html?id=${encodeURIComponent(receta.id)}`;
      const title = document.createElement("h3");
      title.textContent = receta.titulo;
      const summary = document.createElement("p");
      summary.className = "muted";
      summary.textContent = receta.resumen || "Sin descripción";
      const meta = document.createElement("p");
      meta.className = "muted";
      meta.textContent = formatFecha(receta.fecha);
      link.append(title, summary, meta);
      card.append(link);
      recipesEl.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    recipesEl.innerHTML = "<p class='muted'>No se pudieron cargar las recetas.</p>";
  }
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
