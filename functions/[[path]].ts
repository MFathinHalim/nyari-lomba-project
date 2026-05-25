import app from "../server";

export async function onRequest(context: any) {
  // Jalankan routing native Hono yang 100% kompatibel dengan Cloudflare Pages Request
  return app.fetch(context.request, context.env, context);
}