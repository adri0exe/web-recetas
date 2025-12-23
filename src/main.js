import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://qooglpugptjfgitndkdz.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_me8vRoE4wcZoSGzxLSuofA_-vnSFFQr";
const BUCKET_NAME = "recetas-fotos";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabase;

let recetas = [];
let currentSession = null;
let formVisible = false;
let searchTerm = "";
let showFavoritesOnly = false;
let currentPage = 1;
const pageSize = 5;
const FETCH_TIMEOUT = 20000;

const form = document.getElementById("recipe-form");
const recetasContainer = document.getElementById("recetas");
const fotoInput = document.getElementById("foto");
const previewImg = document.getElementById("preview-img");
const submitBtn = document.getElementById("submit-btn");
const loginOverlay = document.getElementById("login-overlay");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const loginToggle = document.getElementById("login-toggle");
const loginClose = document.getElementById("login-close");
const logoutBtn = document.getElementById("logout-btn");
const favoritesToggle = document.getElementById("favorites-toggle");
const authHint = document.getElementById("auth-hint");
const formPanel = document.getElementById("form-panel");
const authUser = document.getElementById("auth-user");
const toggleFormBtn = document.getElementById("toggle-form");
const lightbox = document.getElementById("image-lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const closeLightboxBtn = document.getElementById("close-lightbox");
const searchInput = document.getElementById("search-receta");
const tagInputs = Array.from(document.querySelectorAll('input[name="tags"]'));
const categoryInputs = Array.from(document.querySelectorAll('input[name="categoria"]'));
const pagination = document.getElementById("pagination");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");
const template = document.getElementById("receta-template");

init();

function init() {
  attachListeners();
  ensureSessionWithTimeout();
  syncRecetasWithTimeout();
}

function attachListeners() {
  form.addEventListener("submit", handleSubmit);
  loginForm.addEventListener("submit", handleLogin);
  loginToggle.addEventListener("click", showLogin);
  loginClose.addEventListener("click", hideLogin);
  logoutBtn.addEventListener("click", handleLogout);
  toggleFormBtn.addEventListener("click", toggleFormVisibility);
  closeLightboxBtn.addEventListener("click", hideLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) hideLightbox();
  });
  searchInput.addEventListener("input", handleSearch);
  prevPageBtn.addEventListener("click", () => changePage(-1));
  nextPageBtn.addEventListener("click", () => changePage(1));

  fotoInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) {
      hidePreview();
      return;
    }
    const dataUrl = await fileToDataURL(file);
    showPreview(dataUrl);
  });

  recetasContainer.addEventListener("click", async (event) => {
    const img = event.target.closest(".receta-img");
    if (img && img.dataset.full) {
      showLightbox(img.dataset.full, img.alt || "Foto de la receta");
      return;
    }

    const editBtn = event.target.closest("[data-accion='editar']");
    if (editBtn) {
      if (!currentSession) {
        alert("Inicia sesion para editar recetas.");
        showLogin();
        return;
      }
      const id = editBtn.dataset.id;
      const receta = recetas.find((r) => r.id === id);
      if (!receta) return;
      formVisible = true;
      formPanel.classList.remove("hidden");
      toggleFormBtn.textContent = "Ocultar formulario";
      form.titulo.value = receta.titulo || "";
      form.resumen.value = receta.resumen || "";
      form.ingredientes.value = (receta.ingredientes || []).join("\n");
      form.pasos.value = (receta.pasos || []).join("\n");
      const cat = receta.categoria || "";
      categoryInputs.forEach((input) => {
        input.checked = input.value === cat;
      });
      tagInputs.forEach((input) => {
        input.checked = (receta.tags || []).includes(input.value);
      });
      form.dataset.editingId = id;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const starBtn = event.target.closest("[data-accion='favorita']");
    if (starBtn) {
      if (!currentSession) {
        alert("Inicia sesion para marcar favoritas.");
        showLogin();
        return;
      }
      const id = starBtn.dataset.id;
      await toggleFavorita(id, starBtn);
      return;
    }

    const btn = event.target.closest("[data-accion='eliminar']");
    if (!btn) return;
    if (!currentSession) {
      alert("Inicia sesion para eliminar recetas.");
      showLogin();
      return;
    }
    const id = btn.dataset.id;
    if (!id) return;
    const confirmar = confirm("Eliminar esta receta?");
    if (!confirmar) return;
    await eliminarReceta(id, btn);
  });

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    await refreshUserMeta();
    if (session) hideLogin();
    else showLogin();
    updateAuthUI();
  });
}

async function ensureSessionWithTimeout() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    currentSession = data?.session || null;
    await refreshUserMeta();
    if (currentSession) hideLogin();
  } catch (err) {
    console.warn("Sesion no disponible, intento leer desde localStorage", err);
    const localSession = getLocalSession();
    if (localSession) {
      currentSession = localSession;
      hideLogin();
    } else {
      currentSession = null;
    }
  } finally {
    updateAuthUI();
  }
}

async function refreshUserMeta() {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (data?.user) {
      currentSession = currentSession ? { ...currentSession, user: data.user } : { user: data.user };
    }
  } catch (err) {
    console.warn("No se pudo refrescar el usuario", err);
  }
}

function updateAuthUI() {
  const isLogged = Boolean(currentSession);
  loginToggle.hidden = isLogged;
  logoutBtn.hidden = !isLogged;
  favoritesToggle.hidden = !isLogged;
  favoritesToggle.textContent = showFavoritesOnly ? "Ver todas" : "Ver favoritos";
  if (isLogged && currentSession?.user) {
    authUser.hidden = false;
    authUser.textContent = getDisplayName(currentSession.user);
  } else {
    authUser.hidden = true;
    authUser.textContent = "";
  }
  authHint.textContent = isLogged
    ? "Puedes guardar y eliminar recetas."
    : "Inicia sesion para guardar recetas.";
  formPanel.classList.toggle("hidden", !isLogged || !formVisible);
  submitBtn.disabled = !isLogged;
  toggleFormBtn.hidden = !isLogged;
  toggleFormBtn.textContent = formVisible ? "Ocultar formulario" : "Nueva receta";
  renderRecetas();
}

async function handleLogin(event) {
  event.preventDefault();
  loginBtn.disabled = true;
  loginError.hidden = true;
  loginError.textContent = "";
  try {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentSession = data.session;
    await refreshUserMeta();
    hideLogin();
    updateAuthUI();
    await syncRecetas();
  } catch (err) {
    loginError.hidden = false;
    loginError.textContent = err.message || "No se pudo iniciar sesion.";
  } finally {
    loginBtn.disabled = false;
  }
}

async function handleLogout() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("Error al cerrar sesion", err);
  } finally {
    const { data } = await supabase.auth.getSession();
    currentSession = data?.session || null;
    formVisible = false;
    showFavoritesOnly = false;
    searchTerm = "";
    searchInput.value = "";
    formPanel.classList.add("hidden");
    toggleFormBtn.textContent = "Nueva receta";
    favoritesToggle.textContent = "Ver favoritos";
    showLogin();
    updateAuthUI();
    renderRecetas();
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!currentSession) {
    alert("Inicia sesion para guardar recetas.");
    showLogin();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Guardando...";

  try {
    const titulo = form.titulo.value.trim();
    const resumen = form.resumen.value.trim();
    const ingredientes = toList(form.ingredientes.value);
    const pasos = toList(form.pasos.value);
    const fotoFile = fotoInput.files[0] || null;
    const categoria = (categoryInputs.find((input) => input.checked)?.value || "").trim();
    const tags = tagInputs.filter((input) => input.checked).map((input) => input.value);
    const autorNombre = getDisplayName(currentSession.user);

    if (!titulo || !ingredientes.length || !pasos.length) {
      alert("Completa al menos el nombre, ingredientes y pasos.");
      return;
    }

    const editingId = form.dataset.editingId;
    if (editingId) {
      const recetaActual = recetas.find((r) => r.id === editingId) || {};
      let fotoUrl = recetaActual.foto_url || recetaActual.foto || null;
      if (fotoFile) {
        fotoUrl = await subirFoto(fotoFile);
      }

      const { data, error } = await supabase
        .from("recetas")
        .update({
          titulo,
          resumen,
          ingredientes,
          pasos,
          foto_url: fotoUrl ?? null,
          created_by_name: recetaActual.created_by_name || autorNombre || recetaActual.created_by || null,
          categoria,
          tags,
        })
        .eq("id", editingId)
        .select()
        .single();
      if (error) throw error;
      const idx = recetas.findIndex((r) => r.id === editingId);
      if (idx !== -1) recetas[idx] = { ...recetas[idx], ...data };
    } else {
      let fotoUrl = null;
      if (fotoFile) {
        fotoUrl = await subirFoto(fotoFile);
      }

      const nuevaReceta = {
        id: crypto.randomUUID(),
        titulo,
        resumen,
        ingredientes,
        pasos,
        foto_url: fotoUrl,
        fecha: new Date().toISOString(),
        favorita: false,
        categoria,
        tags,
        created_by: currentSession?.user?.email || null,
        created_by_name: autorNombre || null,
      };

      const { data, error } = await supabase.from("recetas").insert(nuevaReceta).select().single();
      if (error) throw error;

      recetas.unshift(data);
    }

    renderRecetas();
    form.reset();
    delete form.dataset.editingId;
    hidePreview();
    formVisible = false;
    formPanel.classList.add("hidden");
    toggleFormBtn.textContent = "Nueva receta";
  } catch (err) {
    console.error(err);
    const reason = err?.message || "No se pudo guardar la receta. Vuelve a intentarlo.";
    alert(reason);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Guardar receta";
  }
}

async function syncRecetasWithTimeout() {
  recetasContainer.innerHTML = '<p class="muted">Cargando recetas...</p>';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/recetas?select=*`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`fetch status ${resp.status}`);
    const dataFetch = await resp.json();
    recetas = Array.isArray(dataFetch) ? dataFetch : [];
    currentPage = 1;
    renderRecetas();
  } catch (err) {
    console.error("No se pudieron cargar las recetas", err);
    recetasContainer.innerHTML =
      '<p class="empty">No se pudieron cargar las recetas. Comprueba tu conexion.</p>';
  }
}

function renderRecetas() {
  recetasContainer.innerHTML = "";

  const filtradas = filterRecetas(recetas, searchTerm, showFavoritesOnly);

  if (!filtradas.length) {
    recetasContainer.innerHTML = '<p class="empty">No hay recetas guardadas todavia.</p>';
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
    const deleteBtn = clone.querySelector(".delete-btn");
    const starBtn = clone.querySelector(".star-btn");
    const editBtn = clone.querySelector(".edit-btn");

    titleEl.textContent = receta.titulo;
    summaryEl.textContent = receta.resumen || "Sin descripcion";
    const autorDisplay =
      receta.created_by_name ||
      (currentSession?.user?.email && receta.created_by === currentSession.user.email
        ? getDisplayName(currentSession.user)
        : receta.created_by
        ? receta.created_by.split("@")[0]
        : "Autor desconocido");
    metaEl.textContent = `${formatFecha(receta.fecha)} - ${autorDisplay}`;
    deleteBtn.dataset.id = receta.id;
    deleteBtn.disabled = !currentSession;
    deleteBtn.classList.toggle("hidden", !currentSession);
    starBtn.dataset.id = receta.id;
    starBtn.disabled = !currentSession;
    starBtn.classList.toggle("hidden", !currentSession);
    const favorita = Boolean(receta.favorita);
    starBtn.textContent = favorita ? "\u2605" : "\u2606";
    starBtn.classList.toggle("starred", favorita);
    editBtn.dataset.id = receta.id;
    editBtn.disabled = !currentSession;
    editBtn.classList.toggle("hidden", !currentSession);

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
  pageInfo.textContent = `Pagina ${currentPage} de ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function handleSearch(event) {
  searchTerm = (event.target.value || "").trim().toLowerCase();
  currentPage = 1;
  renderRecetas();
}

function toggleFavorites() {
  showFavoritesOnly = !showFavoritesOnly;
  favoritesToggle.textContent = showFavoritesOnly ? "Ver todas" : "Ver favoritos";
  currentPage = 1;
  renderRecetas();
}

function changePage(delta) {
  currentPage = Math.max(1, currentPage + delta);
  renderRecetas();
}

function toList(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
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

function hidePreview() {
  previewImg.hidden = true;
  previewImg.removeAttribute("src");
}

function showPreview(dataUrl) {
  previewImg.hidden = false;
  previewImg.src = dataUrl;
}

function showLogin() {
  loginOverlay.hidden = false;
  loginOverlay.style.display = "grid";
}

function hideLogin() {
  loginOverlay.hidden = true;
  loginOverlay.style.display = "none";
}

async function eliminarReceta(id, btn) {
  try {
    btn.disabled = true;
    const { error } = await supabase.from("recetas").delete().eq("id", id);
    if (error) throw error;
    recetas = recetas.filter((receta) => receta.id !== id);
    renderRecetas();
  } catch (err) {
    console.error(err);
    alert("No se pudo eliminar la receta. Intentalo de nuevo.");
  } finally {
    btn.disabled = false;
  }
}

async function subirFoto(file) {
  const fileName = `${crypto.randomUUID()}-${file.name}`;
  const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(fileName, file);
  if (error) throw error;
  const { data: publicData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(data.path);
  return publicData.publicUrl;
}

async function toggleFavorita(id, btn) {
  try {
    btn.disabled = true;
    const receta = recetas.find((r) => r.id === id);
    const nuevaMarca = !receta?.favorita;
    const { error } = await supabase.from("recetas").update({ favorita: nuevaMarca }).eq("id", id);
    if (error) throw error;
    if (receta) receta.favorita = nuevaMarca;
    btn.textContent = nuevaMarca ? "\u2605" : "\u2606";
    btn.classList.toggle("starred", nuevaMarca);
  } catch (err) {
    console.error(err);
    alert("No se pudo actualizar favorito. Intentalo de nuevo.");
  } finally {
    btn.disabled = false;
  }
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

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function filterRecetas(lista, term, soloFavoritas) {
  let resultado = lista;
  if (soloFavoritas) {
    resultado = resultado.filter((receta) => Boolean(receta.favorita));
  }
  if (!term) return resultado;
  const query = normalizeText(term);
  return resultado.filter((receta) => {
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

function toggleFormVisibility() {
  formVisible = !formVisible;
  formPanel.classList.toggle("hidden", !formVisible);
  toggleFormBtn.textContent = formVisible ? "Ocultar formulario" : "Nueva receta";
}

function getDisplayName(user) {
  if (!user) return "";
  const meta = user.user_metadata || user.raw_user_meta_data || {};
  if (meta.name) return meta.name;
  if (meta.nombre) return meta.nombre;
  if (user.email) return user.email.split("@")[0];
  return "Usuario";
}

function withTimeout(fn, ms, label = "timeout") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    Promise.resolve()
      .then(fn)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function getLocalSession() {
  try {
    const host = new URL(SUPABASE_URL).host;
    const projectRef = host.split(".")[0];
    const key = `sb-${projectRef}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.currentSession || null;
  } catch (err) {
    console.warn("No se pudo leer sesion local", err);
    return null;
  }
}
