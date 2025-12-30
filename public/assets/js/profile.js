import { supabase } from "./supabaseClient.js";
import { AVATAR_BUCKET } from "./config.js";

const form = document.getElementById("profile-form");
const usernameInput = document.getElementById("username");
const fullNameInput = document.getElementById("full_name");
const bioInput = document.getElementById("bio");
const saveBtn = document.getElementById("save-btn");
const statusBox = document.getElementById("profile-status");
const logoutBtn = document.getElementById("logout-btn");
const avatarImg = document.getElementById("avatar-img");
const avatarFile = document.getElementById("avatar-file");
const avatarDrop = document.getElementById("avatar-drop");
const avatarUploadBtn = document.getElementById("avatar-upload-btn");
let avatarSelectedFile = null;
const MAX_AVATAR_WIDTH = 800;
const MAX_AVATAR_HEIGHT = 800;
const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

init();

async function init() {
  logoutBtn?.addEventListener("click", handleLogout);
  form?.addEventListener("submit", handleSave);
  avatarFile?.addEventListener("change", handleAvatarChange);
  avatarUploadBtn?.addEventListener("click", () => avatarFile?.click());
  avatarDrop?.addEventListener("click", () => avatarFile?.click());
  avatarDrop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    avatarDrop.classList.add("dragover");
  });
  avatarDrop?.addEventListener("dragleave", () => {
    avatarDrop.classList.remove("dragover");
  });
  avatarDrop?.addEventListener("drop", handleAvatarDrop);
  await ensureSessionOrRedirect();
  await loadProfile();
}

async function ensureSessionOrRedirect() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) {
    window.location.href = "auth.html";
  }
}

async function loadProfile() {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      window.location.href = "auth.html";
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("username, full_name, bio, avatar_url, id")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    usernameInput.value = data?.username || "";
    fullNameInput.value = data?.full_name || "";
    bioInput.value = data?.bio || "";
    const avatarUrl = data?.avatar_url || generateFallbackAvatar(data, user.email);
    avatarImg.src = avatarUrl;
  } catch (err) {
    console.error(err);
    setStatus(err.message || "No se pudo cargar el perfil", "error");
  }
}

async function handleSave(event) {
  event.preventDefault();
  saveBtn.disabled = true;
  saveBtn.textContent = "Guardando...";
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      window.location.href = "auth.html";
      return;
    }
    let avatarUrl = avatarImg?.src || null;
    const file = avatarSelectedFile || avatarFile?.files?.[0];
    if (file) {
      avatarUrl = await subirAvatar(file, user.id);
    }
    const updates = {
      id: user.id,
      username: usernameInput.value.trim() || null,
      full_name: fullNameInput.value.trim() || null,
      bio: bioInput.value.trim() || null,
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("profiles").upsert(updates);
    if (error) throw error;
  } catch (err) {
    console.error(err);
    setStatus(err.message || "No se pudo guardar el perfil", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Guardar cambios";
  }
}

function handleAvatarChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!isValidAvatarFile(file)) {
    avatarSelectedFile = null;
    avatarFile.value = "";
    return;
  }
  validateAvatarDimensions(file);
}

function handleAvatarDrop(event) {
  event.preventDefault();
  avatarDrop.classList.remove("dragover");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (!isValidAvatarFile(file)) {
    avatarSelectedFile = null;
    avatarFile.value = "";
    return;
  }
  const dt = new DataTransfer();
  dt.items.add(file);
  avatarFile.files = dt.files;
  validateAvatarDimensions(file);
}

function isValidAvatarFile(file) {
  const typeOk = ALLOWED_IMAGE_TYPES.includes(file.type);
  const sizeOk = file.size <= MAX_AVATAR_FILE_SIZE;
  if (!typeOk) {
    alert('El archivo debe ser una imagen JPG, PNG, WEBP o GIF.');
  }
  if (!sizeOk) {
    alert(`La imagen pesa demasiado (${Math.round(file.size / 1024 / 1024)}MB). Maximo ${Math.round(MAX_AVATAR_FILE_SIZE / 1024 / 1024)}MB.`);
  }
  return typeOk && sizeOk;
}

async function validateAvatarDimensions(file) {
  try {
    const { width, height } = await readImageDimensions(file);
    if (width > MAX_AVATAR_WIDTH || height > MAX_AVATAR_HEIGHT) {
      alert(`La imagen es demasiado grande (${width}x${height}). Maximo ${MAX_AVATAR_WIDTH}x${MAX_AVATAR_HEIGHT}.`);
      avatarSelectedFile = null;
      avatarFile.value = "";
      return;
    }
    avatarSelectedFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      avatarImg.src = reader.result;
    };
    reader.readAsDataURL(file);
  } catch (err) {
    console.error("No se pudo validar la imagen de avatar", err);
  }
}

function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

async function handleLogout() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("Error al cerrar sesion", err);
  } finally {
    window.location.href = "auth.html";
  }
}

function setStatus(message, type = "info") {
  if (type !== "error") {
    statusBox.hidden = true;
    statusBox.textContent = "";
    return;
  }
  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

async function subirAvatar(file, userId) {
  const ext = file.name.split(".").pop();
  const fileName = `${userId}/${Date.now()}.${ext || "png"}`;
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).upload(fileName, file, {
    upsert: true,
  });
  if (error) throw error;
  const { data: publicData, error: urlError } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(data.path);
  if (urlError) throw urlError;
  return publicData.publicUrl;
}

function generateFallbackAvatar(profile, email) {
  const seed =
    profile?.username ||
    profile?.full_name ||
    email?.split("@")[0] ||
    "user";
  const encoded = encodeURIComponent(seed);
  return `https://api.dicebear.com/6.x/initials/svg?seed=${encoded}&radius=50&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}
