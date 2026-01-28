import { supabase } from "./supabaseClient.js";
import { applyPreferences, loadUserPreferences } from "./preferences.js";

const loginToggle = document.getElementById("login-toggle");
const logoutBtn = document.getElementById("logout-btn");
const userMenuWrap = document.getElementById("user-menu-wrap");
const userMenuToggle = document.getElementById("user-menu-toggle");
const userMenu = document.getElementById("user-menu");
const profileBtn = document.getElementById("profile-btn");
const favoritesBtn = document.getElementById("favorites-btn");
const myRecipesBtn = document.getElementById("my-recipes-btn");
const toggleFormBtn = document.getElementById("toggle-form");
const authUser = document.getElementById("auth-user");
const authAvatar = document.getElementById("auth-avatar");

let currentSession = null;
let selfProfile = null;
let sessionReady = false;
let isAdmin = false;

init();

async function init() {
  attachListeners();
  await syncPreferences();
  await ensureSession();
  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    if (!session) {
      handleSignedOutState();
      return;
    }
    await fetchSelfProfile();
    await loadUserRole();
    await syncPreferences();
    sessionReady = true;
    updateAuthUI();
  });
}

function attachListeners() {
  loginToggle?.addEventListener("click", redirectToAuth);
  logoutBtn?.addEventListener("click", handleLogout);
  userMenuToggle?.addEventListener("click", toggleUserMenu);
  document.addEventListener("click", (e) => {
    if (!userMenuWrap?.contains(e.target)) {
      closeUserMenu();
    }
  });
  profileBtn?.addEventListener("click", redirectToProfile);
  myRecipesBtn?.addEventListener("click", redirectToMyRecipes);
  favoritesBtn?.addEventListener("click", redirectToFavorites);
  toggleFormBtn?.addEventListener("click", redirectToCreate);
}

async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  currentSession = data?.session || null;
  if (currentSession?.user) {
    await fetchSelfProfile();
    await loadUserRole();
  }
  await syncPreferences();
  sessionReady = true;
  updateAuthUI();
}

async function syncPreferences() {
  const { prefs } = await loadUserPreferences();
  applyPreferences(prefs);
}

function updateAuthUI() {
  if (!sessionReady || !loginToggle || !userMenuWrap) return;
  const isLogged = Boolean(currentSession);
  loginToggle.hidden = isLogged;
  loginToggle.style.visibility = isLogged ? "hidden" : "visible";
  if (logoutBtn) logoutBtn.hidden = !isLogged;
  if (isLogged && currentSession?.user) {
    userMenuWrap.style.display = "inline-block";
    const displayName = selfProfile?.username || getDisplayName(currentSession.user);
    if (authUser) {
      authUser.textContent = displayName;
      renderAdminBadge(authUser);
    }
    if (authAvatar) authAvatar.src = getAvatarUrl(selfProfile, currentSession.user);
    if (toggleFormBtn) toggleFormBtn.hidden = false;
  } else {
    userMenuWrap.style.display = "none";
    if (authUser) {
      authUser.textContent = "";
      clearAdminBadge();
    }
    if (authAvatar) authAvatar.removeAttribute("src");
    if (toggleFormBtn) toggleFormBtn.hidden = true;
  }
}

function toggleUserMenu() {
  if (!userMenu) return;
  userMenu.style.display = userMenu.style.display === "block" ? "none" : "block";
}

function closeUserMenu() {
  if (userMenu) {
    userMenu.style.display = "none";
  }
}

async function fetchSelfProfile() {
  try {
    if (!currentSession?.user?.id) {
      selfProfile = null;
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("username, avatar_url, full_name")
      .eq("id", currentSession.user.id)
      .maybeSingle();
    if (error) throw error;
    selfProfile = data || null;
  } catch (err) {
    console.warn("No se pudo obtener el perfil del usuario", err);
    selfProfile = null;
  }
}

async function handleLogout() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("Error al cerrar sesi\u00f3n", err);
  } finally {
    window.location.href = "auth.html";
  }
}

function handleSignedOutState() {
  currentSession = null;
  selfProfile = null;
  isAdmin = false;
  sessionReady = true;
  syncPreferences();
  updateAuthUI();
}

function redirectToAuth() {
  window.location.href = "auth.html";
}

function redirectToProfile() {
  window.location.href = "profile.html";
}

function redirectToCreate() {
  window.location.href = "create.html";
}

function redirectToMyRecipes() {
  window.location.href = "my-recipes.html";
}

function redirectToFavorites() {
  window.location.href = "favorites.html";
}


function getAvatarUrl(profile, user) {
  if (profile?.avatar_url) return profile.avatar_url;
  const seed =
    profile?.username ||
    profile?.full_name ||
    user?.user_metadata?.username ||
    user?.email?.split("@")[0] ||
    "user";
  const encoded = encodeURIComponent(seed);
  return `https://api.dicebear.com/6.x/initials/svg?seed=${encoded}&radius=50&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

function getDisplayName(user) {
  if (!user) return "";
  const meta = user.user_metadata || user.raw_user_meta_data || {};
  if (meta.username) return meta.username;
  if (meta.user_name) return meta.user_name;
  if (meta.preferred_username) return meta.preferred_username;
  if (user.email) return user.email.split("@")[0];
  return "Usuario";
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

function renderAdminBadge(container) {
  if (!container) return;
  clearAdminBadge();
  if (!isAdmin) return;
  const badge = document.createElement("span");
  badge.className = "admin-badge";
  badge.textContent = "Admin";
  const host = document.getElementById("user-menu-toggle") || container.parentElement;
  if (host) {
    host.appendChild(badge);
    return;
  }
  container.insertAdjacentElement("afterend", badge);
}

function clearAdminBadge() {
  document.querySelectorAll(".admin-badge").forEach((badge) => badge.remove());
}
