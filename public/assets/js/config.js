// Lee la config desde window.ENV (inyectado por Cloudflare Pages) y usa fallback hardcoded
const ENV = (typeof window !== "undefined" && window.ENV) || {};

export const SUPABASE_URL = ENV.SUPABASE_URL || "https://qooglpugptjfgitndkdz.supabase.co";
export const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY || "sb_publishable_me8vRoE4wcZoSGzxLSuofA_-vnSFFQr";
export const STORAGE_BUCKET = ENV.STORAGE_BUCKET || "recetas-fotos";
export const AVATAR_BUCKET = ENV.AVATAR_BUCKET || "avatars";
