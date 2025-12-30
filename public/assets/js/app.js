import { supabase } from "./supabaseClient.js";
import { STORAGE_BUCKET, SUPABASE_URL } from "./config.js";

(async function () {

  let recetas = [];
  let currentSession = null;
  let isAdmin = false;
  let selfProfile = null;
  let sessionReady = false;
  let favoriteIds = new Set();

  const recetasContainer = document.getElementById("recetas");
  const template = document.getElementById("receta-template");
  const loginToggle = document.getElementById("login-toggle");
  const logoutBtn = document.getElementById("logout-btn");
  const userMenuWrap = document.getElementById("user-menu-wrap");
  const userMenuToggle = document.getElementById("user-menu-toggle");
  const userMenu = document.getElementById("user-menu");
  const profileBtn = document.getElementById("profile-btn");
  const favoritesBtn = document.getElementById("favorites-btn");
  const myRecipesBtn = document.getElementById("my-recipes-btn");
  const authUser = document.getElementById("auth-user");
  const authAvatar = document.getElementById("auth-avatar");
  const toggleFormBtn = document.getElementById("toggle-form");
  const lightbox = document.getElementById("image-lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const closeLightboxBtn = document.getElementById("close-lightbox");
  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-receta");
  const sortSelect = document.getElementById("sort-select");
  const toggleFiltersBtn = document.getElementById("toggle-filters");
  const filtersPanel = document.getElementById("filters-panel");
  const clearFiltersBtn = document.getElementById("clear-filters");
  const filterCategoryInputs = Array.from(document.querySelectorAll('input[name="filter-categoria"]'));
  const filterTagInputs = Array.from(document.querySelectorAll('input[name="filter-tag"]'));
  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmAccept = document.getElementById("confirm-accept");
  const pagination = document.getElementById("pagination");
  const prevPageBtn = document.getElementById("prev-page");
  const nextPageBtn = document.getElementById("next-page");
  const pageInfo = document.getElementById("page-info");
  let searchTerm = "";
  let currentPage = 1;
  const pageSize = 5;
  let sortOption = "newest";
  let selectedCategories = new Set();
  let selectedTags = new Set();

  attachListeners();
  await syncRecetas();
  await ensureSession();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    isAdmin = false;
    if (!session) {
      handleSignedOutState();
      return;
    }
    await refreshUserMeta();
    await ensureProfile();
    await fetchSelfProfile();
    await loadFavorites();
    await loadUserRole();
    sessionReady = true;
    updateAuthUI();
  });

  function attachListeners() {
    if (loginToggle) {
      loginToggle.addEventListener("click", () => redirectToAuth());
    }
    logoutBtn.addEventListener("click", handleLogoutClean);
    userMenuToggle?.addEventListener("click", toggleUserMenu);
    document.addEventListener("click", (e) => {
      if (!userMenuWrap?.contains(e.target)) {
        closeUserMenu();
      }
    });
    profileBtn?.addEventListener("click", redirectToProfile);
    myRecipesBtn?.addEventListener("click", redirectToMyRecipes);
    favoritesBtn?.addEventListener("click", redirectToFavorites);
    toggleFormBtn.addEventListener("click", toggleFormVisibility);
    closeLightboxBtn.addEventListener("click", hideLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) hideLightbox();
    });
    searchForm?.addEventListener("submit", handleSearchSubmit);
    sortSelect?.addEventListener("change", handleSortChange);
    normalizeSortLabels();
    toggleFiltersBtn?.addEventListener("click", toggleFiltersPanel);
    filterCategoryInputs.forEach((input) => input.addEventListener("change", handleFiltersChange));
    filterTagInputs.forEach((input) => input.addEventListener("change", handleFiltersChange));
    clearFiltersBtn?.addEventListener("click", clearFilters);
    prevPageBtn.addEventListener("click", () => changePage(-1));
    nextPageBtn.addEventListener("click", () => changePage(1));

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
              redirectToAuth();
              return;
            }
            const id = editBtn.dataset.id;
            if (!id) return;
            const receta = recetas.find((r) => r.id === id);
            if (!receta) return;
            if (!isAdmin && receta.user_id !== currentSession.user.id) {
              alert("Solo el autor o un admin puede editar esta receta.");
              return;
            }
            window.location.href = `create.html?id=${encodeURIComponent(id)}`;
            return;
          }

      const starBtn = event.target.closest("[data-accion='favorita']");
      if (starBtn) {
        if (!currentSession) {
          alert("Inicia sesion para marcar favoritas.");
          redirectToAuth();
          return;
        }
        const id = starBtn.dataset.id;
        if (!id) return;
        const esFavorita = favoriteIds.has(id);
        const ok = await showConfirmModal(
          esFavorita ? "Eliminar de favoritos?" : "Anadir a favoritos?",
          esFavorita ? "Eliminar" : "Anadir"
        );
        if (!ok) return;
        await toggleFavorita(id, starBtn);
        return;
      }

      const btn = event.target.closest("[data-accion='eliminar']");
          if (!btn) return;
          if (!currentSession) {
            alert("Inicia sesion para eliminar recetas.");
            redirectToAuth();
            return;
          }
          const id = btn.dataset.id;
          if (!id) return;
          const receta = recetas.find((r) => r.id === id);
          if (!isAdmin && receta?.user_id !== currentSession.user.id) {
            alert("Solo el autor o un admin puede eliminar esta receta.");
            return;
          }
          const confirmar = await showConfirmModal("Eliminar esta receta?");
          if (!confirmar) return;
          await eliminarReceta(id, btn);
        });
      }

  async function ensureSession() {
    const { data } = await supabase.auth.getSession();
    currentSession = data?.session || getLocalSession();
    isAdmin = false;
    await refreshUserMeta();
    await ensureProfile();
    await fetchSelfProfile();
    await loadFavorites();
    await loadUserRole();
    sessionReady = true;
    updateAuthUI();
  }

  function updateAuthUI() {
    if (!sessionReady) {
      loginToggle.style.visibility = "hidden";
      userMenuWrap.style.display = "none";
      return;
    }
    const isLogged = Boolean(currentSession);
    loginToggle.hidden = isLogged;
    loginToggle.style.visibility = isLogged ? "hidden" : "visible";
    logoutBtn.hidden = !isLogged;
    if (isLogged && currentSession?.user) {
      userMenuWrap.style.display = "inline-block";
      const displayName = selfProfile?.username || getDisplayName(currentSession.user);
      authUser.textContent = displayName;
      if (authAvatar) {
        authAvatar.src = getAvatarUrl(selfProfile, currentSession.user);
      }
    } else {
      userMenuWrap.style.display = "none";
      authUser.textContent = "";
      if (authAvatar) authAvatar.removeAttribute("src");
    }
    toggleFormBtn.hidden = !isLogged;
    toggleFormBtn.textContent = "Nueva receta";
    renderRecetas();
  }

  function toggleFormVisibility() {
    redirectToCreate();
  }

  async function syncRecetas() {
    recetasContainer.innerHTML = '<p class="muted">Cargando recetas...</p>';
    try {
      const { data, error } = await supabase
        .from("recetas")
        .select(`
          *,
          profiles:profiles (
            username,
            full_name,
            avatar_url
          )
        `)
        .order("fecha", { ascending: false });
      if (error) throw error;
      recetas = data || [];
      applyFavoriteFlags();
      currentPage = 1;
      renderRecetas();
    } catch (err) {
      console.error("No se pudieron cargar las recetas", err);
      recetasContainer.innerHTML =
        '<p class="empty">No se pudieron cargar las recetas. Comprueba tu conexion.</p>';
    }
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Error al cerrar sesi??n", err);
    } finally {
      window.location.href = window.location.href;
    }
  }

  async function handleLogoutClean() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Error al cerrar sesion", err);
    } finally {
      closeUserMenu();
      handleSignedOutState();
    }
  }

  function handleSignedOutState() {
    clearLocalSession();
    currentSession = null;
    isAdmin = false;
    selfProfile = null;
    favoriteIds = new Set();
    searchTerm = "";
    searchInput.value = "";
    sessionReady = true;
    updateAuthUI();
  }

  function renderRecetas() {
    recetasContainer.innerHTML = "";

    const filtradas = filterRecetas(recetas, searchTerm);
    const ordenadas = sortRecetas(filtradas);

    if (!ordenadas.length) {
      recetasContainer.innerHTML = '<p class="empty">No hay recetas guardadas todavia.</p>';
      pagination.hidden = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(ordenadas.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * pageSize;
    const paginadas = ordenadas.slice(start, start + pageSize);

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

      const puedeEditar = canEdit(receta);
      titleEl.textContent = receta.titulo;
      summaryEl.textContent = receta.resumen || "Sin descripcion";
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
      deleteBtn.dataset.id = receta.id;
      deleteBtn.disabled = !puedeEditar;
      deleteBtn.classList.toggle("hidden", !puedeEditar);
      deleteBtn.hidden = !puedeEditar;
      starBtn.dataset.id = receta.id;
      starBtn.disabled = !currentSession;
      starBtn.classList.toggle("hidden", !currentSession);
      starBtn.hidden = !currentSession;
      const favorita = favoriteIds.has(receta.id);
      starBtn.textContent = favorita ? "\u2605" : "\u2606";
      starBtn.classList.toggle("starred", favorita);
      editBtn.dataset.id = receta.id;
      editBtn.disabled = !puedeEditar;
      editBtn.classList.toggle("hidden", !puedeEditar);
      editBtn.hidden = !puedeEditar;

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

  function handleSearchSubmit(event) {
    event.preventDefault();
    const term = (searchInput?.value || "").trim();
    if (!term) return;
    const url = new URL("search.html", window.location.href);
    url.searchParams.set("q", term);
    window.location.href = url.toString();
  }

  function handleSortChange(event) {
    sortOption = event.target.value || "newest";
    applySelectedSortLabel(sortOption);
    currentPage = 1;
    renderRecetas();
  }

  function normalizeSortLabels() {
    if (!sortSelect) return;
    Array.from(sortSelect.options).forEach((opt) => {
      if (opt.dataset.label) {
        opt.textContent = opt.dataset.label;
      }
    });
    applySelectedSortLabel(sortSelect.value);
  }

  function applySelectedSortLabel(value) {
    if (!sortSelect) return;
    Array.from(sortSelect.options).forEach((opt) => {
      if (opt.dataset.label) {
        opt.textContent = opt.dataset.label;
      }
    });
    const selected = Array.from(sortSelect.options).find((opt) => opt.value === value);
    if (selected?.dataset.label) {
      selected.textContent = `Ordenar por: ${selected.dataset.label}`;
    }
  }

  function toggleFiltersPanel() {
    filtersPanel?.classList.toggle("hidden");
  }

  function handleFiltersChange() {
    selectedCategories = new Set(
      filterCategoryInputs.filter((input) => input.checked).map((input) => normalizeText(input.value))
    );
    selectedTags = new Set(
      filterTagInputs.filter((input) => input.checked).map((input) => normalizeText(input.value))
    );
    currentPage = 1;
    renderRecetas();
  }

  function clearFilters() {
    filterCategoryInputs.forEach((input) => (input.checked = false));
    filterTagInputs.forEach((input) => (input.checked = false));
    selectedCategories = new Set();
    selectedTags = new Set();
    currentPage = 1;
    renderRecetas();
  }

  function filterRecetas(lista, term) {
    let resultado = lista;
    if (term) {
      const query = normalizeText(term);
      resultado = resultado.filter((receta) => {
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

    if (selectedCategories.size) {
      resultado = resultado.filter((receta) => selectedCategories.has(normalizeText(receta.categoria)));
    }

    if (selectedTags.size) {
      resultado = resultado.filter((receta) =>
        (receta.tags || []).some((tag) => selectedTags.has(normalizeText(tag)))
      );
    }

    return resultado;
  }

  function sortRecetas(lista) {
    const copia = [...lista];
    return copia.sort((a, b) => {
      const fechaA = a.fecha ? new Date(a.fecha).getTime() : 0;
      const fechaB = b.fecha ? new Date(b.fecha).getTime() : 0;

      if (sortOption === "oldest") return fechaA - fechaB;
      if (sortOption === "favorites") {
        const favA = a.favorita ? 1 : 0;
        const favB = b.favorita ? 1 : 0;
        if (favA !== favB) return favB - favA;
        return fechaB - fechaA;
      }
      return fechaB - fechaA;
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

  function showConfirmModal(message, acceptLabel = "Aceptar") {
    return new Promise((resolve) => {
      if (!confirmOverlay || !confirmMessage || !confirmCancel || !confirmAccept) {
        const fallback = window.confirm(message);
        resolve(fallback);
        return;
      }
      confirmMessage.textContent = message || "Seguro que quieres continuar?";
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

  function toggleUserMenu() {
    if (!userMenu) return;
    userMenu.style.display = userMenu.style.display === "block" ? "none" : "block";
  }

  function closeUserMenu() {
    if (userMenu) {
      userMenu.style.display = "none";
    }
  }

  async function eliminarReceta(id, btn) {
    try {
      btn.disabled = true;
      let query = supabase.from("recetas").delete().eq("id", id);
      if (!isAdmin && currentSession?.user?.id) {
        query = query.eq("user_id", currentSession.user.id);
      }
      const { error } = await query;
      if (error) throw error;
      recetas = recetas.filter((receta) => receta.id !== id);
      favoriteIds.delete(id);
      renderRecetas();
    } catch (err) {
      console.error(err);
      alert("No se pudo eliminar la receta. Intentalo de nuevo.");
    } finally {
      btn.disabled = false;
    }
  }

  async function toggleFavorita(id, btn) {
    try {
      btn.disabled = true;
      const receta = recetas.find((r) => r.id === id);
      const esFavorita = favoriteIds.has(id);
      if (esFavorita) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", currentSession.user.id)
          .eq("receta_id", id);
        if (error) throw error;
        favoriteIds.delete(id);
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: currentSession.user.id, receta_id: id });
        if (error) throw error;
        favoriteIds.add(id);
      }
      if (receta) receta.favorita = favoriteIds.has(id);
      btn.textContent = favoriteIds.has(id) ? "\u2605" : "\u2606";
      btn.classList.toggle("starred", favoriteIds.has(id));
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

  function clearLocalSession() {
    try {
      const host = new URL(SUPABASE_URL).host;
      const projectRef = host.split(".")[0];
      const key = `sb-${projectRef}-auth-token`;
      localStorage.removeItem(key);
    } catch (err) {
      console.warn("No se pudo limpiar la sesion local", err);
    }
  }

  async function refreshUserMeta() {
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        currentSession = currentSession ? { ...currentSession, user: data.user } : { user: data.user };
      }
    } catch (err) {
      console.warn("No se pudo refrescar el usuario", err);
    }
  }

  async function ensureProfile() {
    try {
      if (!currentSession?.user?.id) return;
      const userId = currentSession.user.id;
      const { data: existing, error: selectError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (selectError && selectError.code !== "PGRST116") {
        throw selectError;
      }
      if (existing?.id) return;
      const meta = currentSession.user.user_metadata || currentSession.user.raw_user_meta_data || {};
      await supabase.from("profiles").upsert({
        id: userId,
        full_name: meta.full_name || null,
        username:
          meta.username ||
          meta.user_name ||
          meta.preferred_username ||
          currentSession.user.email?.split("@")[0] ||
          null,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("No se pudo asegurar el perfil", err);
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

  async function loadFavorites() {
    try {
      if (!currentSession?.user?.id) {
        favoriteIds = new Set();
        return;
      }
      const { data, error } = await supabase
        .from("favorites")
        .select("receta_id")
        .eq("user_id", currentSession.user.id);
      if (error) throw error;
      favoriteIds = new Set((data || []).map((row) => row.receta_id));
      applyFavoriteFlags();
    } catch (err) {
      console.warn("No se pudieron cargar favoritos", err);
      favoriteIds = new Set();
    }
  }

  function applyFavoriteFlags() {
    if (!Array.isArray(recetas)) return;
    recetas.forEach((r) => {
      r.favorita = favoriteIds.has(r.id);
    });
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

  function canEdit(receta) {
    if (isAdmin) return true;
    if (!currentSession?.user?.id) return false;
    const userId = currentSession.user.id;
    return receta?.user_id === userId;
  }

  function displayAuthor(receta) {
    const p = receta?.profiles;
    if (!p) return "Autor desconocido";
    return p.username || "Autor";
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

})();
