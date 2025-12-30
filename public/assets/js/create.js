import { supabase } from "./supabaseClient.js";
import { STORAGE_BUCKET } from "./config.js";

const form = document.getElementById("recipe-form");
const fotoInput = document.getElementById("foto");
const previewImg = document.getElementById("preview-img");
const submitBtn = document.getElementById("submit-btn");
const authHint = document.getElementById("auth-hint");
const tagInputs = Array.from(document.querySelectorAll('input[name="tags"]'));
const categoryInputs = Array.from(document.querySelectorAll('input[name="categoria"]'));
const formPanel = document.getElementById("form-panel");
let currentSession = null;
let editingId = null;
let recetaActual = null;
const MAX_RECIPE_WIDTH = 2000;
const MAX_RECIPE_HEIGHT = 2000;
const MAX_RECIPE_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

init();

async function init() {
  form.addEventListener("submit", handleSubmit);
  fotoInput.addEventListener("change", previewPhoto);
  await ensureSession();
  await loadIfEditing();
}

async function ensureSession() {
  const { data } = await supabase.auth.getSession();
  currentSession = data?.session || null;
  const isLogged = Boolean(currentSession);
  formPanel.classList.toggle("hidden", !isLogged);
  submitBtn.disabled = !isLogged;
  authHint.textContent = isLogged
    ? "Puedes guardar y eliminar recetas."
    : "Inicia sesion para guardar recetas.";
  if (!isLogged) {
    window.location.href = "auth.html";
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!currentSession) {
    window.location.href = "auth.html";
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = editingId ? "Guardando cambios..." : "Guardando...";
  try {
    const titulo = form.titulo.value.trim();
    const resumen = form.resumen.value.trim();
    const ingredientes = toList(form.ingredientes.value);
    const pasos = toList(form.pasos.value);
    const fotoFile = fotoInput.files[0] || null;
    const categoria = (categoryInputs.find((input) => input.checked)?.value || "").trim();
    const tags = tagInputs.filter((input) => input.checked).map((input) => input.value);

    if (!titulo || !ingredientes.length || !pasos.length) {
      alert("Completa al menos el nombre, ingredientes y pasos.");
      return;
    }

    let fotoUrl = recetaActual?.foto_url || null;
    if (fotoFile) {
      if (!isValidImageFile(fotoFile, MAX_RECIPE_FILE_SIZE)) {
        submitBtn.disabled = false;
        submitBtn.textContent = editingId ? "Guardar cambios" : "Guardar receta";
        return;
      }
      const okDims = await validateImageDimensions(fotoFile, MAX_RECIPE_WIDTH, MAX_RECIPE_HEIGHT);
      if (!okDims) {
        submitBtn.disabled = false;
        submitBtn.textContent = editingId ? "Guardar cambios" : "Guardar receta";
        return;
      }
      fotoUrl = await subirFoto(fotoFile);
    }

    if (editingId) {
      const { error } = await supabase
        .from("recetas")
        .update({
          titulo,
          resumen,
          ingredientes,
          pasos,
          foto_url: fotoUrl ?? null,
          categoria,
          tags,
        })
        .eq("id", editingId)
        .eq("user_id", currentSession.user.id);
      if (error) throw error;
    } else {
      const nuevaReceta = {
        id: crypto.randomUUID(),
        titulo,
        resumen,
        ingredientes,
        pasos,
        foto_url: fotoUrl ?? null,
        fecha: new Date().toISOString(),
        categoria,
        tags,
        user_id: currentSession.user.id,
      };

      const { error } = await supabase.from("recetas").insert(nuevaReceta);
      if (error) throw error;
    }

    form.reset();
    hidePreview();
    window.location.href = "index.html";
  } catch (err) {
    console.error(err);
    alert(err?.message || "No se pudo guardar la receta. Inténtalo de nuevo.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingId ? "Guardar cambios" : "Guardar receta";
  }
}

function toList(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function subirFoto(file) {
  const fileName = `${crypto.randomUUID()}-${file.name}`;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, file);
  if (error) throw error;
  const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(data.path);
  return publicData.publicUrl;
}

function previewPhoto(event) {
  const file = event.target.files[0];
  if (!file) {
    hidePreview();
    return;
  }
  if (!isValidImageFile(file, MAX_RECIPE_FILE_SIZE)) {
    fotoInput.value = "";
    hidePreview();
    return;
  }
  validateImageDimensions(file, MAX_RECIPE_WIDTH, MAX_RECIPE_HEIGHT).then((ok) => {
    if (!ok) return;
    const reader = new FileReader();
    reader.onload = () => {
      previewImg.hidden = false;
      previewImg.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function hidePreview() {
  previewImg.hidden = true;
  previewImg.removeAttribute("src");
}

function isValidImageFile(file, maxSize) {
  const typeOk = ALLOWED_IMAGE_TYPES.includes(file.type);
  const sizeOk = file.size <= maxSize;
  if (!typeOk) {
    alert("El archivo debe ser una imagen JPG, PNG, WEBP o GIF.");
  }
  if (!sizeOk) {
    alert(`La imagen pesa demasiado (${Math.round(file.size / 1024 / 1024)}MB). Maximo ${Math.round(maxSize / 1024 / 1024)}MB.`);
  }
  return typeOk && sizeOk;
}

async function validateImageDimensions(file, maxWidth, maxHeight) {
  try {
    const { width, height } = await readImageDimensions(file);
    if (width > maxWidth || height > maxHeight) {
      alert(`La imagen es demasiado grande (${width}x${height}). Máximo ${maxWidth}x${maxHeight}.`);
      fotoInput.value = "";
      hidePreview();
      return false;
    }
    return true;
  } catch (err) {
    console.error("No se pudo validar la imagen", err);
    return false;
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

async function loadIfEditing() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) return;
  editingId = id;
  submitBtn.textContent = "Guardar cambios";
  const headerTitle = formPanel.querySelector("h2");
  if (headerTitle) headerTitle.textContent = "Edita tu receta";
  try {
    const { data, error } = await supabase.from("recetas").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) {
      alert("No se encontró la receta.");
      window.location.href = "index.html";
      return;
    }
    if (data.user_id && data.user_id !== currentSession?.user?.id) {
      alert("No puedes editar una receta que no es tuya.");
      window.location.href = "index.html";
      return;
    }
    recetaActual = data;
    form.titulo.value = data.titulo || "";
    form.resumen.value = data.resumen || "";
    form.ingredientes.value = (data.ingredientes || []).join("\n");
    form.pasos.value = (data.pasos || []).join("\n");
    const cat = data.categoria || "";
    categoryInputs.forEach((input) => {
      input.checked = input.value === cat;
    });
    tagInputs.forEach((input) => {
      input.checked = (data.tags || []).includes(input.value);
    });
    const fotoUrl = data.foto_url || data.foto || null;
    if (fotoUrl) {
      previewImg.hidden = false;
      previewImg.src = fotoUrl;
    }
  } catch (err) {
    console.error(err);
    alert(err?.message || "No se pudo cargar la receta.");
    window.location.href = "index.html";
  }
}
