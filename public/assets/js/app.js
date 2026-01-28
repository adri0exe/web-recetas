import { supabase } from "./supabaseClient.js";
import { SUPABASE_URL } from "./config.js";
import { applyPreferences, loadUserPreferences } from "./preferences.js";

(async function () {
  let featuredRecetas = [];
  let featuredIndex = 0;
  let isAnimating = false;
  let currentSession = null;
  let isAdmin = false;
  let selfProfile = null;
  let sessionReady = false;
  let favoriteIds = new Set();
  const MORE_PAGE_SIZE = 10;
  let morePage = 0;
  let moreLoading = false;
  let moreDone = false;

  const STAR_ON = String.fromCharCode(9733);
  const STAR_OFF = String.fromCharCode(9734);

  const featuredStage = document.getElementById("featured-stage");
  const featuredTemplate = document.getElementById("featured-template");
  const featuredPrevBtn = document.getElementById("featured-prev");
  const featuredNextBtn = document.getElementById("featured-next");
  const featuredCounter = document.getElementById("featured-counter");
  const featuredDots = document.getElementById("featured-dots");
  const featuredEmpty = document.getElementById("featured-empty");
  const randomRecetasEl = document.getElementById("random-recetas");
  const randomTemplate = document.getElementById("random-receta-template");
  const moreRecetasEl = document.getElementById("more-recetas");
  const loadMoreBtn = document.getElementById("load-more-recetas");

  const loginToggle = document.getElementById("login-toggle");
  const logoutBtn = document.getElementById("logout-btn");
  const userMenuWrap = document.getElementById("user-menu-wrap");
  const userMenuToggle = document.getElementById("user-menu-toggle");
  const userMenu = document.getElementById("user-menu");
  const profileBtn = document.getElementById("profile-btn");
  const favoritesBtn = document.getElementById("favorites-btn");
  const myRecipesBtn = document.getElementById("my-recipes-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const authUser = document.getElementById("auth-user");
  const authAvatar = document.getElementById("auth-avatar");
  const toggleFormBtn = document.getElementById("toggle-form");
  const confirmOverlay = document.getElementById("confirm-overlay");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmCancel = document.getElementById("confirm-cancel");
  const confirmAccept = document.getElementById("confirm-accept");

  attachListeners();
  await syncPreferences();
  await syncRecetas();
  await loadRandomRecetas();
  await loadMoreRecetas();
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
    await syncPreferences();
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
    settingsBtn?.addEventListener("click", redirectToSettings);
    toggleFormBtn.addEventListener("click", toggleFormVisibility);

    featuredPrevBtn?.addEventListener("click", () => moveFeatured(-1));
    featuredNextBtn?.addEventListener("click", () => moveFeatured(1));

    featuredDots?.addEventListener("click", (event) => {
      const dot = event.target.closest("button[data-index]");
      if (!dot) return;
      const index = Number(dot.dataset.index || 0);
      jumpFeatured(index);
    });

    featuredStage?.addEventListener("click", async (event) => {
      const featuredBtn = event.target.closest("[data-accion='destacada']");
      if (featuredBtn) {
        if (!isAdmin) return;
        const id = featuredBtn.dataset.id;
        if (!id) return;
        await toggleDestacada(id, featuredBtn);
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

      const card = event.target.closest(".featured-card");
      if (!card || event.target.closest("button") || event.target.closest("a")) return;
      const id = card.dataset.id;
      if (!id) return;
      window.location.href = `recipe-view.html?id=${encodeURIComponent(id)}`;
    });

    randomRecetasEl?.addEventListener("click", (event) => {
      const card = event.target.closest(".receta");
      if (!card || event.target.closest("button") || event.target.closest("a")) return;
      const id = card.dataset.id;
      if (!id) return;
      window.location.href = `recipe-view.html?id=${encodeURIComponent(id)}`;
    });

    loadMoreBtn?.addEventListener("click", () => {
      loadMoreRecetas();
    });

    document.addEventListener("keydown", (event) => {
      if (!featuredRecetas.length) return;
      const target = event.target;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowRight") moveFeatured(1);
      if (event.key === "ArrowLeft") moveFeatured(-1);
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
    await syncPreferences();
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
      renderAdminBadge(authUser);
      if (authAvatar) {
        authAvatar.src = getAvatarUrl(selfProfile, currentSession.user);
      }
    } else {
      userMenuWrap.style.display = "none";
      authUser.textContent = "";
      clearAdminBadge();
      if (authAvatar) authAvatar.removeAttribute("src");
    }
    toggleFormBtn.hidden = !isLogged;
    toggleFormBtn.textContent = "Nueva receta";
    renderFeatured();
  }

  function toggleFormVisibility() {
    redirectToCreate();
  }

  async function syncRecetas() {
    if (featuredStage) {
      featuredStage.innerHTML = '<p class="muted">Cargando destacadas...</p>';
    }
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
        .eq("destacada", true)
        .order("views", { ascending: false, nullsFirst: false })
        .limit(8);
      if (error) throw error;
      featuredRecetas = (data || []).filter((receta) => hasRecipeImage(receta));
      applyFavoriteFlags();
      featuredIndex = 0;
      renderFeatured();
    } catch (err) {
      console.error("No se pudieron cargar las recetas destacadas", err);
      if (featuredStage) {
        featuredStage.innerHTML =
          '<p class="empty">No se pudieron cargar las destacadas. Comprueba tu conexion.</p>';
      }
    }
  }

  function renderFeatured() {
    if (!featuredStage) return;

    if (!featuredRecetas.length) {
      featuredStage.innerHTML = "";
      featuredStage.style.height = "";
      if (featuredEmpty) {
        featuredEmpty.hidden = false;
        featuredStage.appendChild(featuredEmpty);
      }
      updateFeaturedControls();
      return;
    }

    if (featuredEmpty) featuredEmpty.hidden = true;

    const total = featuredRecetas.length;
    const receta = featuredRecetas[featuredIndex];
    const prev = total > 1 ? featuredRecetas[getWrappedIndex(featuredIndex - 1, total)] : null;
    const next = total > 1 ? featuredRecetas[getWrappedIndex(featuredIndex + 1, total)] : null;
    const card = buildFeaturedCard(receta, "featured-card--current");
    featuredStage.innerHTML = "";
    if (prev) featuredStage.appendChild(buildFeaturedCard(prev, "featured-card--prev"));
    if (next) featuredStage.appendChild(buildFeaturedCard(next, "featured-card--next"));
    featuredStage.appendChild(card);
    updateFeaturedStageHeight();
    updateFeaturedControls();
  }

  function buildFeaturedCard(receta, variantClass) {
    const clone = featuredTemplate.content.cloneNode(true);
    const card = clone.querySelector(".featured-card");
    const titleEl = clone.querySelector(".featured-title");
    const imgEl = clone.querySelector(".featured-img");
    const summaryEl = clone.querySelector(".featured-summary");
    const metaEl = clone.querySelector(".featured-meta");
    const tagsEl = clone.querySelector(".featured-tags");
    const starBtn = clone.querySelector(".star-btn");
    const featuredBtn = clone.querySelector(".featured-toggle");
    const ctaBtn = clone.querySelector(".featured-cta .primary");

    if (card) card.dataset.id = receta.id;
    titleEl.textContent = receta.titulo;
    summaryEl.textContent = truncateText(getSummary(receta), 160);

    metaEl.innerHTML = "";
    metaEl.appendChild(document.createTextNode(`${formatFecha(receta.fecha)} - `));
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
    starBtn.disabled = !currentSession;
    starBtn.classList.toggle("hidden", !currentSession);
    starBtn.hidden = !currentSession;
    const favorita = favoriteIds.has(receta.id);
    starBtn.textContent = favorita ? STAR_ON : STAR_OFF;
    starBtn.classList.toggle("starred", favorita);

    if (featuredBtn) {
      featuredBtn.dataset.id = receta.id;
      featuredBtn.hidden = !isAdmin;
      featuredBtn.classList.toggle("hidden", !isAdmin);
      setFeaturedButtonState(featuredBtn, Boolean(receta.destacada));
    }

    const fotoUrl = receta.foto_url || receta.foto || "assets/img/imagen.png";
    imgEl.src = fotoUrl;
    imgEl.alt = `Foto de ${receta.titulo}`;

    tagsEl.innerHTML = "";
    const tags = Array.isArray(receta.tags) ? receta.tags.slice(0, 4) : [];
    if (tags.length) {
      tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "featured-tag";
        chip.textContent = tag;
        tagsEl.appendChild(chip);
      });
    }

    if (ctaBtn) {
      ctaBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        window.location.href = `recipe-view.html?id=${encodeURIComponent(receta.id)}`;
      });
    }

    return card;
  }

  async function loadRandomRecetas() {
    if (!randomRecetasEl) return;
    randomRecetasEl.innerHTML = '<p class="muted">Cargando recetas aleatorias...</p>';
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
        .order("fecha", { ascending: false })
        .limit(6);
      if (error) throw error;
      const pool = Array.isArray(data) ? data : [];
      const source = pool.length ? pool : featuredRecetas;
      renderRandomRecetas(source.slice(0, 6));
    } catch (err) {
      console.error("No se pudieron cargar recetas aleatorias", err);
      randomRecetasEl.innerHTML =
        '<p class="empty">No se pudieron cargar las recetas aleatorias. Comprueba tu conexion.</p>';
    }
  }

  async function loadMoreRecetas() {
    if (!moreRecetasEl || moreLoading || moreDone) return;
    moreLoading = true;
    if (loadMoreBtn) loadMoreBtn.disabled = true;
    if (morePage === 0) {
      moreRecetasEl.innerHTML = '<p class="muted">Cargando mas recetas...</p>';
    }
    try {
      const from = morePage * MORE_PAGE_SIZE;
      const to = from + MORE_PAGE_SIZE - 1;
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
        .order("fecha", { ascending: false })
        .range(from, to);
      if (error) throw error;
      const items = Array.isArray(data) ? data : [];
      if (!items.length && morePage === 0) {
        moreRecetasEl.innerHTML = '<p class="empty">No hay mas recetas para mostrar.</p>';
        if (loadMoreBtn) loadMoreBtn.hidden = true;
        moreDone = true;
        return;
      }
      if (morePage === 0) moreRecetasEl.innerHTML = "";
      items.forEach((receta) => {
        const card = buildRandomCard(receta);
        if (card) moreRecetasEl.appendChild(card);
      });
      if (items.length < MORE_PAGE_SIZE) {
        moreDone = true;
        if (loadMoreBtn) loadMoreBtn.hidden = true;
      }
      morePage += 1;
    } catch (err) {
      console.error("No se pudieron cargar mas recetas", err);
      if (morePage === 0) {
        moreRecetasEl.innerHTML =
          '<p class="empty">No se pudieron cargar mas recetas. Comprueba tu conexion.</p>';
      }
    } finally {
      moreLoading = false;
      if (loadMoreBtn) loadMoreBtn.disabled = false;
    }
  }

  function renderRandomRecetas(recetas) {
    if (!randomRecetasEl) return;
    randomRecetasEl.innerHTML = "";
    if (!Array.isArray(recetas) || !recetas.length) {
      randomRecetasEl.innerHTML = '<p class="empty">No hay recetas aleatorias para mostrar.</p>';
      return;
    }
    recetas.forEach((receta) => {
      const card = buildRandomCard(receta);
      if (card) randomRecetasEl.appendChild(card);
    });
  }

  function buildRandomCard(receta) {
    if (!randomTemplate) return null;
    const clone = randomTemplate.content.cloneNode(true);
    const card = clone.querySelector(".receta");
    const titleEl = clone.querySelector(".receta-title");
    const summaryEl = clone.querySelector(".receta-summary");
    const imgEl = clone.querySelector(".receta-img");
    const mediaEl = clone.querySelector(".receta-media");
    const metaTextEl = clone.querySelector(".receta-meta-text");
    const tagsEl = clone.querySelector(".receta-tags");

    if (card) {
      card.dataset.id = receta.id;
    }
    if (titleEl) titleEl.textContent = receta.titulo || "Receta";
    if (summaryEl) summaryEl.textContent = truncateText(getSummary(receta), 140);

    if (metaTextEl) {
      metaTextEl.textContent = `${formatFecha(receta.fecha)} - ${displayAuthor(receta)}`;
    }

    if (imgEl && mediaEl) {
      const fotoUrl = receta.foto_url || receta.foto;
      if (typeof fotoUrl === "string" && fotoUrl.trim().length > 0) {
        imgEl.src = fotoUrl;
        imgEl.alt = `Foto de ${receta.titulo || "receta"}`;
      } else {
        imgEl.remove();
        const placeholder = document.createElement("div");
        placeholder.className = "receta-no-image";
        placeholder.textContent = "Sin imagen";
        mediaEl.appendChild(placeholder);
      }
    }

    if (tagsEl) {
      tagsEl.innerHTML = "";
      const tags = Array.isArray(receta.tags) ? receta.tags.slice(0, 4) : [];
      tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = tag;
        tagsEl.appendChild(chip);
      });
    }

    return card;
  }

  function moveFeatured(direction) {
    if (!featuredRecetas.length) return;
    const total = featuredRecetas.length;
    if (total < 2) return;
    const nextIndex = (featuredIndex + direction + total) % total;
    transitionFeatured(nextIndex, direction > 0 ? "next" : "prev");
  }

  function jumpFeatured(index) {
    if (!featuredRecetas.length) return;
    if (index === featuredIndex) return;
    const direction = index > featuredIndex ? "next" : "prev";
    transitionFeatured(index, direction);
  }

  function transitionFeatured(index, direction) {
    if (isAnimating) return;
    if (!featuredStage) return;

    if (prefersReducedMotion()) {
      featuredIndex = index;
      renderFeatured();
      return;
    }

    const currentCard = featuredStage.querySelector(".featured-card--current");
    const nextCard =
      direction === "next"
        ? featuredStage.querySelector(".featured-card--next")
        : featuredStage.querySelector(".featured-card--prev");
    const otherCard =
      direction === "next"
        ? featuredStage.querySelector(".featured-card--prev")
        : featuredStage.querySelector(".featured-card--next");
    if (!currentCard || !nextCard) {
      featuredIndex = index;
      renderFeatured();
      return;
    }

    isAnimating = true;
    const exitClass = direction === "next" ? "is-exiting-next" : "is-exiting-prev";
    const enterClass = direction === "next" ? "is-entering-next" : "is-entering-prev";

    currentCard.classList.add(exitClass);
    nextCard.classList.add(enterClass);
    if (otherCard) otherCard.classList.add("is-fading");

    nextCard.addEventListener(
      "animationend",
      () => {
        featuredIndex = index;
        renderFeatured();
        isAnimating = false;
      },
      { once: true }
    );
  }

  function updateFeaturedControls() {
    const total = featuredRecetas.length;
    if (featuredCounter) {
      featuredCounter.textContent = total ? `${featuredIndex + 1} / ${total}` : "0 / 0";
    }
    if (featuredPrevBtn) featuredPrevBtn.disabled = total < 2;
    if (featuredNextBtn) featuredNextBtn.disabled = total < 2;
    renderFeaturedDots(total);
  }

  function renderFeaturedDots(total) {
    if (!featuredDots) return;
    featuredDots.innerHTML = "";
    if (!total) return;
    for (let i = 0; i < total; i += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "featured-dot";
      if (i === featuredIndex) btn.classList.add("active");
      btn.dataset.index = String(i);
      btn.setAttribute("aria-label", `Ir a destacada ${i + 1}`);
      featuredDots.appendChild(btn);
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Error al cerrar sesion", err);
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
    sessionReady = true;
    syncPreferences();
    updateAuthUI();
  }

  function updateFeaturedStageHeight() {
    if (!featuredStage) return;
    const currentCard = featuredStage.querySelector(".featured-card--current");
    if (!currentCard) return;
    requestAnimationFrame(() => {
      const extra = 40;
      featuredStage.style.height = `${currentCard.offsetHeight + extra}px`;
    });
  }

  async function syncPreferences() {
    const { prefs } = await loadUserPreferences();
    applyPreferences(prefs);
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

  function redirectToSettings() {
    window.location.href = "settings.html";
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

  async function toggleFavorita(id, btn) {
    try {
      btn.disabled = true;
      const receta = featuredRecetas.find((r) => r.id === id);
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
      btn.textContent = favoriteIds.has(id) ? STAR_ON : STAR_OFF;
      btn.classList.toggle("starred", favoriteIds.has(id));
    } catch (err) {
      console.error(err);
      alert("No se pudo actualizar favorito. Intentalo de nuevo.");
    } finally {
      btn.disabled = false;
    }
  }

  async function toggleDestacada(id, btn) {
    try {
      btn.disabled = true;
      const receta = featuredRecetas.find((r) => r.id === id);
      const nextValue = !receta?.destacada;
      const { error } = await supabase.from("recetas").update({ destacada: nextValue }).eq("id", id);
      if (error) throw error;
      if (receta) receta.destacada = nextValue;

      if (!nextValue) {
        featuredRecetas = featuredRecetas.filter((r) => r.id !== id);
        if (featuredIndex >= featuredRecetas.length) {
          featuredIndex = Math.max(0, featuredRecetas.length - 1);
        }
        renderFeatured();
        return;
      }

      setFeaturedButtonState(btn, nextValue);
    } catch (err) {
      console.error(err);
      alert("No se pudo actualizar destacada. Intentalo de nuevo.");
    } finally {
      btn.disabled = false;
    }
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
    if (!Array.isArray(featuredRecetas)) return;
    featuredRecetas.forEach((r) => {
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

  function getSummary(receta) {
    return receta?.resumen || receta?.descripcion || "Sin descripcion todavia.";
  }

  function hasRecipeImage(receta) {
    const value = receta?.foto_url || receta?.foto;
    if (typeof value === "string") return value.trim().length > 0;
    return Boolean(value);
  }

  function truncateText(value, max) {
    const text = (value || "").toString().trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
  }

  function getWrappedIndex(index, total) {
    if (!total) return 0;
    return (index + total) % total;
  }

  function getRandomSample(list, size) {
    if (!Array.isArray(list)) return [];
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.max(0, size));
  }

  function setFeaturedButtonState(btn, isFeatured) {
    if (!btn) return;
    btn.textContent = isFeatured ? "Quitar destacada" : "Destacar";
    btn.classList.toggle("is-featured", isFeatured);
    btn.setAttribute("aria-pressed", isFeatured ? "true" : "false");
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
})();
