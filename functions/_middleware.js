export async function onRequest(context) {
  const response = await context.next();

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const env = context.env || {};
  const supabaseUrl = env.SUPABASE_URL || "";
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || "";
  const storageBucket = env.STORAGE_BUCKET || "";
  const avatarBucket = env.AVATAR_BUCKET || "";

  const injection = `<script>
      window.ENV = {
        SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
        SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)},
        STORAGE_BUCKET: ${JSON.stringify(storageBucket)},
        AVATAR_BUCKET: ${JSON.stringify(avatarBucket)}
      };
    </script>`;

  const html = await response.text();

  const patched = html.includes("</head>")
    ? html.replace("</head>", injection + "\n</head>")
    : html + injection;

  return new Response(patched, {
    status: response.status,
    headers: response.headers,
  });
}
