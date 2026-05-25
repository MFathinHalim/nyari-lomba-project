import app from "../server"; // Pastikan path ini mengarah ke file server.ts kamu

export async function onRequest(context: any) {
  // Oper seluruh request dan environment Cloudflare (termasuk MY_BROWSER) ke Express
  return app.fetch(context.request, context.env, context);
}