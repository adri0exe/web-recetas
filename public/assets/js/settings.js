import { applyPreferences, loadUserPreferences, saveUserPreferences, t } from "./preferences.js";

const themeSelect = document.getElementById("settings-theme");
const languageSelect = document.getElementById("settings-language");
const densitySelect = document.getElementById("settings-density");
const statusEl = document.getElementById("settings-status");
const quickSettings = document.querySelectorAll(".quick-setting");

let currentPrefs = null;
init();

async function init() {
  const { prefs } = await loadUserPreferences();
  currentPrefs = normalizeThemeForQuickSettings(prefs);
  applyPreferences(currentPrefs);
  syncFormValues();

  themeSelect?.addEventListener("change", handleChange);
  languageSelect?.addEventListener("change", handleChange);
  densitySelect?.addEventListener("change", handleChange);
  attachQuickSettings();
}

function syncFormValues() {
  if (!currentPrefs) return;
  if (themeSelect) themeSelect.value = currentPrefs.theme;
  if (languageSelect) languageSelect.value = currentPrefs.language;
  if (densitySelect) densitySelect.value = currentPrefs.density;
  syncQuickButtons();
}

function handleChange() {
  currentPrefs = {
    theme: themeSelect?.value || "auto",
    language: languageSelect?.value || "es",
    density: densitySelect?.value || "comoda",
  };
  applyPreferences(currentPrefs);
  autoSave();
  syncQuickButtons();
  clearStatus();
}

function attachQuickSettings() {
  if (!quickSettings.length) return;
  quickSettings.forEach((group) => {
    group.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const setting = group.getAttribute("data-setting");
        const value = btn.getAttribute("data-value");
        if (!setting || !value) return;
        currentPrefs = {
          theme: currentPrefs?.theme || "auto",
          language: currentPrefs?.language || "es",
          density: currentPrefs?.density || "comoda",
        };
        currentPrefs[setting] = value;
        if (themeSelect) themeSelect.value = currentPrefs.theme;
        if (languageSelect) languageSelect.value = currentPrefs.language;
        if (densitySelect) densitySelect.value = currentPrefs.density;
        applyPreferences(currentPrefs);
        autoSave();
        syncQuickButtons();
        clearStatus();
      });
    });
  });
}

function syncQuickButtons() {
  if (!quickSettings.length || !currentPrefs) return;
  quickSettings.forEach((group) => {
    const setting = group.getAttribute("data-setting");
    if (!setting) return;
    const value = currentPrefs[setting];
    group.querySelectorAll(".quick-btn").forEach((btn) => {
      const btnValue = btn.getAttribute("data-value");
      btn.classList.toggle("is-active", btnValue === value);
    });
  });
}

function setStatus(message, type = "info") {
  if (!statusEl) return;
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function clearStatus() {
  if (!statusEl) return;
  statusEl.hidden = true;
  statusEl.textContent = "";
  statusEl.className = "status";
}

async function autoSave() {
  const lang = currentPrefs?.language || "es";
  const result = await saveUserPreferences(currentPrefs);
  if (!result.ok) {
    console.error(result.error);
    setStatus(t("settings.save_error", lang), "error");
    return;
  }
  const key = result.localOnly ? "settings.saved_local" : "settings.saved";
  setStatus(t(key, lang), "success");
}

function normalizeThemeForQuickSettings(prefs) {
  const next = { ...prefs };
  if (next.theme === "auto") {
    const prefersDark =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    next.theme = prefersDark ? "dark" : "light";
    currentPrefs = next;
    autoSave();
  }
  return next;
}
