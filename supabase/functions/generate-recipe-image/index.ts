import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const HF_API_KEY = Deno.env.get("HF_API_KEY") || "";
const STORAGE_BUCKET = Deno.env.get("STORAGE_BUCKET") || "recetas-fotos";
const HF_MODEL =
  Deno.env.get("HF_MODEL") || "stabilityai/stable-diffusion-xl-base-1.0";

// Si una receta lleva "pending" más de X minutos, permitimos reintento automático
const PENDING_TTL_MINUTES = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Metodo no permitido" });

  // Validación de env
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !HF_API_KEY) {
    console.error("ENV missing", {
      hasUrl: !!SUPABASE_URL,
      hasServiceRole: !!SERVICE_ROLE_KEY,
      hasHf: !!HF_API_KEY,
    });
    return json(500, { error: "Faltan variables de entorno" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json().catch(() => null);
    const recetaId: string | undefined = body?.receta_id;
    const force: boolean = body?.force === true;

    if (!recetaId) return json(400, { error: "receta_id requerido" });

    console.log("REQ start", { recetaId, force, model: HF_MODEL, bucket: STORAGE_BUCKET });

    // Leer receta
    const { data: receta, error: recetaError } = await supabase
      .from("recetas")
      .select(
        "id, titulo, ingredientes, categoria, tags, foto_url, image_status, image_updated_at"
      )
      .eq("id", recetaId)
      .maybeSingle();

    if (recetaError) {
      console.error("DB select error", recetaError);
      return json(500, { error: "Error leyendo receta" });
    }
    if (!receta) return json(404, { error: "Receta no encontrada" });

    // Si ya existe foto, devolvemos
    if (receta.foto_url && !force) {
      console.log("Already has foto_url", receta.foto_url);
      return json(200, { status: "exists", publicUrl: receta.foto_url });
    }

    // Si está pending y NO force, miramos TTL para no quedarnos bloqueados para siempre
    if (receta.image_status === "pending" && !force) {
      const updatedAt = receta.image_updated_at
        ? new Date(receta.image_updated_at)
        : null;

      if (updatedAt) {
        const ageMs = Date.now() - updatedAt.getTime();
        const ageMin = ageMs / 1000 / 60;
        if (ageMin < PENDING_TTL_MINUTES) {
          console.log("Still pending (within TTL)", { ageMin });
          return json(200, { status: "pending" });
        }
        console.log("Pending expired -> retry", { ageMin });
      } else {
        console.log("Pending without updated_at -> retry");
      }
      // Si expiró, continuamos para reintentar
    }

    // Marcar como pending antes de comenzar
    const { error: pendingErr } = await supabase
      .from("recetas")
      .update({
        image_status: "pending",
        image_error: null,
        image_updated_at: new Date().toISOString(),
      })
      .eq("id", recetaId);

    if (pendingErr) {
      console.error("DB update pending error", pendingErr);
      return json(500, { error: "No se pudo marcar como pending", detail: pendingErr });
    }

    // Construir prompt
    const prompt = buildPrompt(receta);
    console.log("Prompt built", { prompt });

    // Llamar a HuggingFace
    console.log("Calling HuggingFace...", { HF_MODEL });
    const hfResponse = await fetch(
      `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: prompt }),
      }
    );

    if (!hfResponse.ok) {
      const errText = await hfResponse.text();
      console.error("HF error", { status: hfResponse.status, errText });

      await supabase
        .from("recetas")
        .update({
          image_status: "error",
          image_error: `HF ${hfResponse.status}: ${errText}`.slice(0, 5000),
          image_updated_at: new Date().toISOString(),
        })
        .eq("id", recetaId);

      return json(502, { error: "HuggingFace error", detail: errText });
    }

    // Descargar imagen
    const contentType = hfResponse.headers.get("content-type") || "image/png";
    const imageBuffer = await hfResponse.arrayBuffer();

    if (!imageBuffer || imageBuffer.byteLength < 1000) {
      const tiny = await hfResponse.text().catch(() => "");
      console.error("HF returned too small payload", { contentType, tiny });

      await supabase
        .from("recetas")
        .update({
          image_status: "error",
          image_error: "HF devolvió payload inválido (muy pequeño o no imagen)",
          image_updated_at: new Date().toISOString(),
        })
        .eq("id", recetaId);

      return json(502, { error: "HF devolvió una respuesta inválida" });
    }

    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const fileName = `${recetaId}-${crypto.randomUUID()}.${ext}`;

    // Subir a Storage
    console.log("Uploading to Storage...", { fileName, contentType });
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, imageBuffer, { contentType, upsert: false });

    if (uploadError) {
      console.error("Storage upload error", uploadError);

      await supabase
        .from("recetas")
        .update({
          image_status: "error",
          image_error: `Storage upload: ${uploadError.message}`.slice(0, 5000),
          image_updated_at: new Date().toISOString(),
        })
        .eq("id", recetaId);

      return json(500, { error: "Error subiendo a Storage", detail: uploadError.message });
    }

    // Public URL
    const { data: publicData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(uploadData.path);

    const publicUrl = publicData.publicUrl;
    console.log("Public URL ready", { publicUrl });

    // Actualizar BD
    const { error: updateErr } = await supabase
      .from("recetas")
      .update({
        foto_url: publicUrl,
        image_prompt: prompt,
        image_status: "ready",
        image_error: null,
        image_updated_at: new Date().toISOString(),
      })
      .eq("id", recetaId);

    if (updateErr) {
      console.error("DB update final error", updateErr);

      // No devolvemos error total porque la imagen YA está subida.
      return json(200, {
        status: "ready",
        publicUrl,
        warning: "Imagen subida, pero no se pudo actualizar la BD",
      });
    }

    console.log("DONE", { recetaId, publicUrl });
    return json(200, { status: "ready", publicUrl });
  } catch (err) {
    console.error("Unhandled error", err);
    return json(500, { error: err?.message || "Error interno" });
  }
});

function buildPrompt(receta: {
  titulo?: string;
  ingredientes?: string[];
  categoria?: string;
  tags?: string[];
}) {
  const title = receta.titulo || "plato casero";
  const categoria = receta.categoria ? `, categoria ${receta.categoria}` : "";
  const tags =
    Array.isArray(receta.tags) && receta.tags.length
      ? `, estilos ${receta.tags.slice(0, 4).join(", ")}`
      : "";
  const ingredientes =
    Array.isArray(receta.ingredientes) && receta.ingredientes.length
      ? `, ingredientes visibles: ${receta.ingredientes.slice(0, 6).join(", ")}`
      : "";
  return `Fotografia realista de comida, plato "${title}"${categoria}${ingredientes}${tags}, luz natural, fondo limpio, alta calidad, detalle apetitoso.`;
}
