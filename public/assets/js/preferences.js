import { supabase } from "./supabaseClient.js";

const STORAGE_KEY = "recetas-preferences";

export const DEFAULT_PREFS = {
  theme: "auto",
  language: "es",
  density: "comoda",
};

const STRINGS = {
  es: {
    "menu.new_recipe": "Nueva receta",
    "menu.my_recipes": "Mis recetas",
    "menu.favorites": "Favoritas",
    "menu.profile": "Perfil",
    "menu.settings": "Configuracion",
    "menu.logout": "Cerrar sesion",
    "auth.login": "Iniciar sesion",
    "nav.back": "Volver",
    "settings.title": "Configuracion",
    "settings.eyebrow": "Preferencias",
    "settings.subtitle": "Personaliza tu experiencia",
    "settings.theme": "Tema",
    "settings.language": "Idioma",
    "settings.density": "Densidad",
    "settings.save": "Guardar cambios",
    "settings.login_hint": "Inicia sesion para guardar tu configuracion.",
    "settings.saved": "Configuracion guardada.",
    "settings.saved_local": "Configuracion guardada en este dispositivo.",
    "settings.save_error": "No se pudo guardar la configuracion.",
    "settings.theme.auto": "Automatico",
    "settings.theme.light": "Claro",
    "settings.theme.dark": "Oscuro",
    "settings.language.es": "Espanol",
    "settings.language.en": "Ingles",
    "settings.density.comoda": "Comoda",
    "settings.density.compacta": "Compacta",
  },
  en: {
    "menu.new_recipe": "New recipe",
    "menu.my_recipes": "My recipes",
    "menu.favorites": "Favorites",
    "menu.profile": "Profile",
    "menu.settings": "Settings",
    "menu.logout": "Sign out",
    "auth.login": "Sign in",
    "nav.back": "Back",
    "settings.title": "Settings",
    "settings.eyebrow": "Preferences",
    "settings.subtitle": "Personalize your experience",
    "settings.theme": "Theme",
    "settings.language": "Language",
    "settings.density": "Density",
    "settings.save": "Save changes",
    "settings.login_hint": "Sign in to save your settings.",
    "settings.saved": "Settings saved.",
    "settings.saved_local": "Settings saved on this device.",
    "settings.save_error": "Could not save settings.",
    "settings.theme.auto": "Auto",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "settings.language.es": "Spanish",
    "settings.language.en": "English",
    "settings.density.comoda": "Comfortable",
    "settings.density.compacta": "Compact",
  },
};

export async function loadUserPreferences() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user || null;
  if (!user) {
    return { prefs: loadCachedPreferences(), loggedIn: false };
  }
  const meta = user.user_metadata || {};
  const prefs = normalizePrefs({
    theme: meta.theme,
    language: meta.language,
    density: meta.density,
  });
  setCachedPreferences(prefs);
  return {
    prefs,
    loggedIn: true,
  };
}

export async function saveUserPreferences(prefs) {
  const { data } = await supabase.auth.getUser();
  const user = data?.user || null;
  if (!user) {
    const next = normalizePrefs(prefs);
    setCachedPreferences(next);
    return { ok: true, prefs: next, localOnly: true };
  }
  const next = normalizePrefs(prefs);
  const existing = user.user_metadata || {};
  const { error } = await supabase.auth.updateUser({
    data: {
      ...existing,
      theme: next.theme,
      language: next.language,
      density: next.density,
    },
  });
  if (error) {
    return { ok: false, error };
  }
  setCachedPreferences(next);
  return { ok: true, prefs: next };
}

export function applyPreferences(prefs) {
  const next = normalizePrefs(prefs);
  applyTheme(next.theme);
  applyDensity(next.density);
  applyLanguage(next.language);
}

export function t(key, lang = "es") {
  const strings = STRINGS[lang] || STRINGS.es;
  return strings[key] || STRINGS.es[key] || "";
}

function normalizePrefs(prefs = {}) {
  return {
    theme: normalizeTheme(prefs.theme),
    language: normalizeLanguage(prefs.language),
    density: normalizeDensity(prefs.density),
  };
}

function normalizeTheme(value) {
  if (value === "dark" || value === "light" || value === "auto") return value;
  return DEFAULT_PREFS.theme;
}

function normalizeLanguage(value) {
  if (value === "en" || value === "es") return value;
  return DEFAULT_PREFS.language;
}

function normalizeDensity(value) {
  if (value === "compacta" || value === "comoda") return value;
  return DEFAULT_PREFS.density;
}

function applyTheme(theme) {
  const body = document.body;
  const root = document.documentElement;
  if (!body || !root) return;
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "auto" && prefersDark);
  body.classList.toggle("theme-dark", isDark);
  root.classList.toggle("theme-dark", isDark);
  applyThemeVars(isDark);
}

function applyThemeVars(isDark) {
  const root = document.documentElement;
  if (!root) return;
  const vars = {
    "--bg":
      "radial-gradient(circle at 20% 20%, #2b1f1b, transparent 30%)," +
      "radial-gradient(circle at 80% 0%, #1f2a36, transparent 25%)," +
      "radial-gradient(circle at 50% 100%, #2a241d, transparent 35%)," +
      "#15110f",
    "--panel": "#1c1714",
    "--ink": "#f4ede6",
    "--muted": "#c6b8ad",
    "--primary": "#ff8a5c",
    "--primary-strong": "#ff6f3b",
    "--border": "#3a2f2a",
    "--accent": "#f0c27b",
    "--shadow": "0 24px 60px rgba(0, 0, 0, 0.45)",
  };
  Object.keys(vars).forEach((key) => {
    if (isDark) {
      root.style.setProperty(key, vars[key]);
    } else {
      root.style.removeProperty(key);
    }
  });
}

function applyDensity(density) {
  const body = document.body;
  if (!body) return;
  body.classList.toggle("density-compact", density === "compacta");
}

function applyLanguage(language) {
  const lang = language === "en" ? "en" : "es";
  document.documentElement.lang = lang;
  const strings = STRINGS[lang] || STRINGS.es;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const value = strings[key] || STRINGS.es[key];
    if (!value) return;
    const attr = el.getAttribute("data-i18n-attr");
    if (attr) {
      el.setAttribute(attr, value);
      if (attr === "placeholder") return;
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    el.textContent = value;
  });
}

function setCachedPreferences(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn("No se pudieron guardar preferencias locales", err);
  }
}

function clearCachedPreferences() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("No se pudieron limpiar preferencias locales", err);
  }
}

function loadCachedPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return normalizePrefs(parsed);
  } catch (err) {
    console.warn("No se pudieron leer preferencias locales", err);
    return { ...DEFAULT_PREFS };
  }
}
