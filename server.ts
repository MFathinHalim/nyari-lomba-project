import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as cheerio from 'cheerio'
import * as puppeteer from '@cloudflare/puppeteer'
import axios from 'axios'

type Env = {
  Bindings: {
    MY_BROWSER: puppeteer.BrowserWorker
    PUSPRESNAS_KV: KVNamespace // Wadah RAM permanen Cloudflare
  }
}

const app = new Hono<Env>()

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONFIG
// ─────────────────────────────────────────────────────────────────────────────
interface Competition {
  id: string;
  title: string;
  shortDescription: string;
  url: string;
  source: string;
  deadline: string;
  category: string;
  tags: string[];
  isUpcoming: boolean;
  imageUrl: string; 
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Business: ["business", "entrepreneur", "startup", "marketing", "case", "bisnis", "ekonomi", "manajemen", "akuntansi"],
  Arts: ["design", "art", "creative", "illustration", "visual", "film", "festival", "movie", "video", "sinematografi", "foto", "photography", "poster", "lukis", "gambar", "musik", "lagu", "seni", "olahraga", "o2sn", "fls2n"],
  Science: ["science", "tech", "technology", "research", "innovation", "sains", "matematika", "fisika", "biologi", "kimia", "olimpiade", "riset", "karya tulis", "kti", "osn"],
  "E-Sports": ["esports", "gaming", "valorant", "mlbb", "mobile legends", "game", "turnamen", "tournament", "pubg"],
  Writing: ["writing", "cerpen", "essay", "story", "literature", "poetry", "menulis", "esai", "puisi", "sastra", "novel"],
  IT: ["hackathon", "software", "developer", "web", "app", "blockchain", "programming", "coding", "ui/ux", "cyber", "data science", "ai", "cloud"],
};

function guessCategory(raw: string): string {
  const content = raw.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => content.includes(kw))) return category;
  }
  return "IT"; 
}

function normalizeId(url: string, prefix: string): string {
  return `${prefix}:${url.replace(/https?:\/\//, "").replace(/[\W_]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUNGGOH-SUNGGOH CHROMIUM SCRAPER (HANYA JALAN DI BACKGROUND)
// ─────────────────────────────────────────────────────────────────────────────
async function runPuspresnasScraperEngine(env: Env['Bindings']): Promise<Competition[]> {
  if (!env.MY_BROWSER) return [];
  
  const competitions: Competition[] = [];
  const jenjangs = ["sd", "smp", "sma"];
  
  const browser = await puppeteer.launch(env.MY_BROWSER);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  for (const jenjang of jenjangs) {
    try {
      const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      
      // Jeda render persis yang lu mau
      await new Promise((r) => setTimeout(r, 3000));

      const html = await page.content();
      const $ = cheerio.load(html);

      $("div.card").each((_, el) => {
        const card = $(el);
        const titleElement = card.find("a.card-title h5, h5");
        const title = titleElement.text().trim();
        if (!title) return;

        let detailUrl = card.find("a.card-title").attr("href")?.trim() || targetUrl;
        if (!detailUrl.startsWith("http")) {
          detailUrl = `https://pusatprestasinasional.kemendikdasmen.go.id${detailUrl.startsWith("/") ? "" : "/"}${detailUrl}`;
        }

        let imageUrl = card.find("img.card-img-top").attr("src")?.trim() || "";
        if (imageUrl && !imageUrl.startsWith("http")) {
          imageUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/${imageUrl.replace(/^\//, "")}`;
        }

        const deadlineText = card.find("span.badge-gray:has(i.fa-calendar-day)").text().trim() || "Lihat Panduan";

        competitions.push({
          id: normalizeId(detailUrl, `puspresnas-${jenjang}`),
          title,
          shortDescription: `Kompetisi Resmi Puspresnas Jenjang ${jenjang.toUpperCase()}.`,
          url: detailUrl,
          source: "Puspresnas",
          deadline: deadlineText.replace(/[\n\t]/g, "").trim(),
          category: guessCategory(title),
          tags: ["Puspresnas", jenjang.toUpperCase()],
          isUpcoming: true,
          imageUrl
        });
      });

      // Jeda anti-banned
      await new Promise((r) => setTimeout(r, 4000));
    } catch (e) {
      // lanjut ke jenjang berikutnya kalau ada satu yang eror
      continue;
    }
  }

  await browser.close();
  return competitions;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINTS EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

// Endpoint Puspresnas Instan - GAK BAKAL LAG / 503 karena baca dari KV Storage
app.get("/api/competitions/puspresnas", async (c) => {
  try {
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const category = c.req.query("category") || "all";

    // Ambil data mentah teks dari Cloudflare KV Storage
    const cachedData = await c.env.PUSPRESNAS_KV.get("puspresnas_data");
    
    let competitions: Competition[] = [];
    if (cachedData) {
      competitions = JSON.parse(cachedData);
    } else {
      // Kasih data tiruan darurat kalau seandainya cron belum berjalan biar gak kosong bgt
      return c.json({ 
        message: "Sistem sedang mengumpulkan data awal dari pusat prestasi nasional. Silakan refresh 1 menit lagi.", 
        data: [] 
      });
    }

    if (q) competitions = competitions.filter((comp) => comp.title.toLowerCase().includes(q));
    if (category !== "all") competitions = competitions.filter((comp) => comp.category === category);

    return c.json(competitions);
  } catch {
    return c.json({ error: "Failed to read data from storage." }, 500);
  }
});

// Endpoint pemicu manual seandainya lu males nungguin Cron Job otomatis
app.get("/api/competitions/puspresnas/force-scrape", async (c) => {
  try {
    const data = await runPuspresnasScraperEngine(c.env);
    if (data.length > 0) {
      await c.env.PUSPRESNAS_KV.put("puspresnas_data", JSON.stringify(data));
      return c.json({ success: true, message: `Berhasil scrape manual ${data.length} data.` });
    }
    return c.json({ success: false, message: "Scraper berjalan namun mengembalikan 0 data." }, 400);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CRON TRIGGER HANDLER (MENGGANTIKAN APP.LISTEN STARTUP EXPRESS)
// ─────────────────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch, // Jalur request API biasa
  
  async Tracy(event: any, env: Env['Bindings'], ctx: ExecutionContext) {
    // Dipicu otomatis tiap sejam sekali oleh cloudflare system background scheduler
    ctx.waitUntil(
      runPuspresnasScraperEngine(env).then(async (data) => {
        if (data && data.length > 0) {
          await env.PUSPRESNAS_KV.put("puspresnas_data", JSON.stringify(data));
        }
      })
    );
  },
  // Fallback untuk kompabilitas scheduler syntax baru
  async scheduled(event: any, env: Env['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(
      runPuspresnasScraperEngine(env).then(async (data) => {
        if (data && data.length > 0) {
          await env.PUSPRESNAS_KV.put("puspresnas_data", JSON.stringify(data));
        }
      })
    );
  }
}