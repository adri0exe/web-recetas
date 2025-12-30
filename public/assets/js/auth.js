import { supabase } from "./supabaseClient.js";

const loginCard = document.getElementById("login-card");
const signupCard = document.getElementById("signup-card");
const toSignupBtn = document.getElementById("to-signup");
const toLoginBtn = document.getElementById("to-login");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const signupEmail = document.getElementById("signup-email");  
const signupPassword = document.getElementById("signup-password");
const signupName = document.getElementById("signup-name");
const signupUsername = document.getElementById("signup-username");
const loginError = document.getElementById("login-error");
const signupError = document.getElementById("signup-error");
const loginBtn = document.getElementById("login-btn");
const signupBtn = document.getElementById("signup-btn");
const statusBox = document.getElementById("auth-status");
const googleBtn = document.getElementById("google-btn");
const forgotBtn = document.getElementById("forgot-password");

init();

function init() {
  toSignupBtn?.addEventListener("click", () => showSignup(true));
  toLoginBtn?.addEventListener("click", () => showSignup(false));
  loginForm?.addEventListener("submit", handleLogin);
  signupForm?.addEventListener("submit", handleSignup);
  googleBtn?.addEventListener("click", handleGoogleLogin);
  forgotBtn?.addEventListener("click", handleResetPassword);
  checkExistingSession();
}

async function checkExistingSession() {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    setStatus("Ya tienes sesion iniciada.", "info");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  clearErrors();
  loginBtn.disabled = true;
  loginBtn.textContent = "Entrando...";
  try {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setStatus("Sesion iniciada. Redirigiendo...", "success");
    window.location.href = "index.html";
  } catch (err) {
    loginError.hidden = false;
    loginError.textContent = err.message || "No se pudo iniciar sesion.";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Entrar";
  }
}

async function handleSignup(event) {
  event.preventDefault();
  clearErrors();
  signupBtn.disabled = true;
  signupBtn.textContent = "Creando...";
  try {
    const email = signupEmail.value.trim();
    const password = signupPassword.value;
    const fullName = signupName.value.trim();
    const username = signupUsername.value.trim();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || null,
          username: username || null,
        },
      },
    });
    if (error) throw error;

    if (data?.session?.user) {
      await upsertProfile(data.session.user, { fullName, username });
      setStatus("Cuenta creada. Redirigiendo...", "success");
      window.location.href = "index.html";
    } else {
      setStatus(
        "Cuenta creada. Revisa tu correo para confirmar y luego inicia sesion.",
        "info"
      );
    }
  } catch (err) {
    signupError.hidden = false;
    signupError.textContent = err.message || "No se pudo crear la cuenta.";
  } finally {
    signupBtn.disabled = false;
    signupBtn.textContent = "Crear cuenta";
  }
}

async function handleGoogleLogin() {
  clearErrors();
  try {
    googleBtn.disabled = true;
    googleBtn.textContent = "Abriendo Google...";
    const redirectTo = new URL("index.html", window.location.href).toString();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
    setStatus("Redirigiendo a Google...", "info");
  } catch (err) {
    setStatus(err.message || "No se pudo iniciar sesion con Google.", "error");
  } finally {
    googleBtn.disabled = false;
    googleBtn.textContent = "Continuar con Google";
  }
}

async function handleResetPassword() {
  clearErrors();
  const email = loginEmail?.value?.trim() || "";
  if (!email) {
    loginError.hidden = false;
    loginError.textContent = "Introduce tu correo para recuperar la contrasena.";
    return;
  }
  try {
    forgotBtn.disabled = true;
    forgotBtn.textContent = "Enviando...";
    const redirectTo = new URL("auth.html", window.location.href).toString();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    setStatus("Te enviamos un enlace para restablecer tu contrasena.", "info");
  } catch (err) {
    setStatus(err.message || "No se pudo enviar el enlace de recuperacion.", "error");
  } finally {
    forgotBtn.disabled = false;
    forgotBtn.textContent = "Olvide mi contrasena";
  }
}

async function upsertProfile(user, { fullName, username }) {
  try {
    await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        full_name: fullName || null,
        username: username || user.email?.split("@")[0] || null,
        updated_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn("No se pudo actualizar el perfil", err);
  }
}

function showSignup(show) {
  if (show) {
    loginCard.hidden = true;
    signupCard.hidden = false;
  } else {
    loginCard.hidden = false;
    signupCard.hidden = true;
  }
}

function clearErrors() {
  loginError.hidden = true;
  loginError.textContent = "";
  signupError.hidden = true;
  signupError.textContent = "";
}

function setStatus(message, type = "info") {
  statusBox.hidden = false;
  statusBox.textContent = message;
  statusBox.className = `auth-status ${type}`;
}
