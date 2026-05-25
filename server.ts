import { Hono } from "hono";
import { cors } from "hono/cors";
import * as cheerio from "cheerio";
import axios from "axios";
import { chromium } from "playwright"; 

// ─────────────────────────────────────────────────────────────────────────────
// Types & Global Cache
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

const GLOBAL_CACHE = {
  puspresnas: [] as Competition[],
  isPuspresnasReady: false
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants, Keywords, & Helpers
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Business: ["business", "entrepreneur", "startup", "marketing", "case", "bisnis", "ekonomi", "manajemen", "akuntansi"],
  Arts: ["design", "art", "creative", "illustration", "visual", "film", "festival", "movie", "video", "sinematografi", "foto", "photography", "poster", "lukis", "gambar", "musik", "lagu", "seni", "olahraga", "o2sn", "fls2n"],
  Science: ["science", "tech", "technology", "research", "innovation", "sains", "matematika", "fisika", "biologi", "kimia", "olimpiade", "riset", "karya tulis", "kti", "osn"],
  "E-Sports": ["esports", "gaming", "valorant", "mlbb", "mobile legends", "game", "turnamen", "tournament", "pubg"],
  Writing: ["writing", "cerpen", "essay", "story", "literature", "poetry", "menulis", "esai", "puisi", "sastra", "novel"],
  IT: ["hackathon", "software", "developer", "web", "app", "blockchain", "programming", "coding", "ui/ux", "cyber", "data science", "ai", "cloud"],
};

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
};

const PUSPRESNAS_JENJANGS = ["sd", "smp", "sma"];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function guessCategory(raw: string): string {
  const content = raw.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => content.includes(kw))) {
      return category;
    }
  }
  return "IT"; 
}

function normalizeCompetition(comp: Partial<Competition>): Competition {
  return {
    id: comp.id || `unknown-${Math.random().toString(36).slice(2, 8)}`,
    title: comp.title || "Untitled Competition",
    shortDescription: comp.shortDescription || "No description available.",
    url: comp.url || "#",
    source: comp.source || "Unknown",
    deadline: comp.deadline || "TBA",
    category: comp.category || "IT",
    tags: comp.tags || [],
    isUpcoming: comp.isUpcoming ?? true,
    imageUrl: comp.imageUrl || "", 
  };
}

function normalizeId(url: string, prefix: string): string {
  const cleaned = url
    .replace(/https?:\/\//, "")
    .replace(/\?.*$/, "")
    .replace(/[#/]+$/, "")
    .replace(/[\W_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}:${cleaned}`;
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const response = await axios.get(url, {
      headers: DEFAULT_HEADERS,
      timeout: 10000, 
    });
    return response.data;
  } catch (error: any) {
    console.error(`[Scraper Warning] Gagal ambil HTML dari: ${url}`);
    return ""; 
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Robust Puspresnas Cache Warmup (Cloudflare Browser Rendering Native)
// ─────────────────────────────────────────────────────────────────────────────

async function warmUpPuspresnasCache(env: any): Promise<void> {
  let browser;
  const competitions: Competition[] = [];
  console.log("[Cache] Memulai Puspresnas via Cloudflare Browser Rendering...");

  try {
    browser = await (chromium as any).connectWithBrowser(env.MY_BROWSER);    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    for (const jenjang of PUSPRESNAS_JENJANGS) {
      const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`;
      try {
        console.log(`[Cache] Scrape jenjang: ${jenjang.toUpperCase()}...`);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);

        const html = await page.content();
        const $ = cheerio.load(html);
        let countPerJenjang = 0;

        $("div.card").each((_, el) => {
          const card = $(el);
          const titleElement = card.find("a.card-title h5, h5");
          const title = titleElement.text().trim();
          if (!title) return;

          let detailUrl = card.find("a.card-title").attr("href")?.trim() || targetUrl;
          if (detailUrl && !detailUrl.startsWith("http")) {
            detailUrl = `https://pusatprestasinasional.kemendikdasmen.go.id${detailUrl.startsWith("/") ? "" : "/"}${detailUrl}`;
          }

          let imageUrl = card.find("img.card-img-top").attr("src")?.trim() || "";
          if (imageUrl && !imageUrl.startsWith("http")) {
            imageUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/${imageUrl.replace(/^\//, "")}`;
          }

          const deadlineText = card.find("span.badge-gray:has(i.fa-calendar-day)").text().trim() || "Lihat Panduan";
          const id = normalizeId(detailUrl, `puspresnas-${jenjang}`);

          competitions.push(normalizeCompetition({
            id,
            title,
            shortDescription: `Kompetisi Resmi Puspresnas Jenjang ${jenjang.toUpperCase()}.`,
            url: detailUrl,
            source: "Puspresnas",
            deadline: deadlineText.replace(/[\n\t]/g, "").trim(),
            category: guessCategory(title),
            tags: ["Puspresnas", jenjang.toUpperCase()],
            isUpcoming: true,
            imageUrl
          }));
          countPerJenjang++;
        });

        console.log(`[Cache Success] Berhasil ambil ${countPerJenjang} lomba dari ${jenjang.toUpperCase()}`);
        await delay(2000);
      } catch (e: any) {
        console.error(`[Cache Error] Gagal di jenjang ${jenjang}: ${e.message}`);
        continue;
      }
    }
    
    GLOBAL_CACHE.puspresnas = competitions;
    GLOBAL_CACHE.isPuspresnasReady = true;
    console.log(`[Cache Ready] RAM Cache Terisi: ${competitions.length} event.`);
  } catch (err) {
    console.error("[Cache Error] Gagal total akses Browser Cloudflare:", err);
  } finally {
    if (browser) await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Parsers
// ─────────────────────────────────────────────────────────────────────────────

function parseInfoLombaCompetitions(html: string, query: string): Competition[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();
  const baseUrl = "https://www.infolomba.id";

  $(".event-container").each((_, el) => {
    const container = $(el);
    const anchor = container.find(".event-title a").first();
    const title = anchor.text().trim();
    if (!title) return;

    let finalUrl = "";
    const onClickAttr = anchor.attr("onclick")?.trim() || "";
    const match = onClickAttr.match(/loadDetailsEvent\s*\(\s*(\d+)\s*,\s*['"]([^'"]+)['"]/);
    if (match && match[1] && match[2]) {
      finalUrl = `${baseUrl}/info-${match[2]}-${match[1]}`;
    } else {
      let href = anchor.attr("href")?.trim() || "";
      if (href && href !== "#") finalUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
    }

    let imageUrl = container.find(".img-container img").first().attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) imageUrl = `${baseUrl}/${imageUrl}`;

    const tanggalText = container.find(".tanggal").text().trim();
    const competition = normalizeCompetition({
      id: normalizeId(finalUrl, "infolomba"),
      title,
      shortDescription: `Info lomba terupdate via InfoLomba.id.`,
      url: finalUrl,
      source: "InfoLomba",
      deadline: tanggalText.split("-").pop()?.trim() || tanggalText,
      category: guessCategory(title),
      tags: ["InfoLomba"],
      isUpcoming: !container.hasClass("event-past"),
      imageUrl,
    });

    if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery)) {
      competitions.push(competition);
    }
  });
  return competitions;
}

function parseLuarKampusCompetitions(html: string): Competition[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const baseUrl = "https://luarkampus.id";

  $("a[href*='/events/']").each((_, el) => {
    const card = $(el);
    const title = card.find("p.font-bold").text().trim();
    if (!title) return;

    let href = card.attr("href")?.trim() || "";
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
    
    let rawImg = card.find("img").first().attr("src")?.trim() || "";
    let imageUrl = rawImg ? (rawImg.startsWith("http") ? rawImg : `${baseUrl}/${rawImg.startsWith("/") ? "" : "/"}${rawImg}`) : "";
    const deadline = card.find("span.text-red-600 b").text().trim() || "TBA";

    competitions.push(normalizeCompetition({
      id: normalizeId(detailUrl, "luarkampus"),
      title,
      shortDescription: `Info event kompetisi mahasiswa dari LuarKampus.`,
      url: detailUrl,
      source: "LuarKampus",
      deadline,
      category: guessCategory(title),
      tags: ["LuarKampus"],
      isUpcoming: true,
      imageUrl
    }));
  });
  return competitions;
}

function parseKompetisiCoIdCompetitions(html: string): Competition[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const baseUrl = "https://kompetisi.co.id";

  $(".group.bg-white").each((_, el) => {
    const card = $(el);
    let title = card.find("h3").text().trim().replace(/\s+/g, " ");
    if (!title) return;

    let href = card.find("a[href*='kompetisi?id=']").first().attr("href")?.trim() || "";
    if (!href) return;
    const detailUrl = `${baseUrl}/${href.replace(/^\//, "")}`;

    let imageUrl = "";
    const posterButtonOnclick = card.find("button[onclick*='openPoster']").attr("onclick") || "";
    const posterMatch = posterButtonOnclick.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/);
    
    if (posterMatch && posterMatch[1]) {
      imageUrl = posterMatch[1].trim();
    } else {
      imageUrl = card.find("img").first().attr("src")?.trim() || "";
    }

    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `${baseUrl}/${imageUrl.replace(/^\//, "")}`;
    }

    let deadlineText = "Lihat Jadwal";
    const finalRow = card.find("div:has(span:contains('Final'))").last();
    if (finalRow.length) {
      deadlineText = finalRow.find("span").last().text().trim();
    }

    competitions.push(normalizeCompetition({
      id: normalizeId(detailUrl, "kompetisicoid"),
      title,
      shortDescription: `Kompetisi Terkurasi oleh Kompetisi.co.id.`,
      url: detailUrl,
      source: "Kompetisi.co.id",
      deadline: deadlineText,
      category: guessCategory(title),
      tags: ["CompetisiCoId"],
      isUpcoming: true,
      imageUrl,
    }));
  });
  return competitions;
}

function parseKompetisiOnline(html: string, query: string): Competition[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();
  const baseUrl = "https://kompetisionline.com";

  $(".group.bg-white").each((_, el) => {
    const card = $(el);
    let title = card.find("h3").text().trim();
    card.find("h3 span").each((_, spanEl) => {
      title = title.replace($(spanEl).text(), "").trim();
    });
    title = title.replace(/\s+/g, " ");
    if (!title) return;

    const anchor = card.find("a[href*='kompetisi?id=']").first();
    let href = anchor.attr("href")?.trim() || "";
    if (!href) return; 
    
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}/${href.replace(/^\//, "")}`;
    const id = normalizeId(detailUrl, "kompetisionline");

    let imageUrl = "";
    const posterButtonOnclick = card.find("button[onclick*='openPoster']").attr("onclick") || "";
    const posterMatch = posterButtonOnclick.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/);
    
    if (posterMatch && posterMatch[1]) {
      imageUrl = posterMatch[1].trim();
    } else {
      imageUrl = card.find("img").first().attr("src")?.trim() || "";
    }

    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `${baseUrl}/${imageUrl.replace(/^\//, "")}`;
    }

    const tags: string[] = [];
    card.find("span").each((_, badgeEl) => {
      const tagText = $(badgeEl).text().trim();
      if (tagText && tagText.length < 20 && !/2026|Penyisihan|Final|Batch/i.test(tagText)) {
        tags.push(tagText);
      }
    });

    let deadlineText = "Lihat di Web";
    const finalScheduleEl = card.find("div:has(span:contains('Final'))").last();
    if (finalScheduleEl.length) {
      deadlineText = finalScheduleEl.find("span").last().text().trim();
    }

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: `Info lomba terupdate via KompetisiOnline.com.`,
      url: detailUrl,
      source: "KompetisiOnline",
      deadline: deadlineText, 
      category: guessCategory(`${title} ${tags.join(" ")}`),
      tags: tags.length > 0 ? tags : ["KompetisiOnline"],
      isUpcoming: true,
      imageUrl,
    });

    if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery) || tags.some(t => t.toLowerCase().includes(lowerQuery))) {
      competitions.push(competition);  
    }
  });
  return competitions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFastSourcesOnly(query: string): Promise<Competition[]> {
  const normalizedQuery = query.trim();
  const encodedQuery = encodeURIComponent(normalizedQuery);
  const infolombaUrl = normalizedQuery
    ? `https://www.infolomba.id/events?sort=Default&title=${encodedQuery}`
    : "https://www.infolomba.id/events";

  const currentMonth = new Date().getMonth() + 1; 
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;

  const promises = [
    fetchHtml(infolombaUrl).then((html) => parseInfoLombaCompetitions(html, normalizedQuery)),
    fetchHtml("https://kompetisi.co.id/?page=1").then((html) => parseKompetisiCoIdCompetitions(html)),
    fetchHtml("https://kompetisi.co.id/?page=2").then((html) => parseKompetisiCoIdCompetitions(html)),
    fetchHtml("https://kompetisionline.com/?page=1").then((html) => parseKompetisiOnline(html, normalizedQuery)),
    fetchHtml("https://kompetisionline.com/?page=2").then((html) => parseKompetisiOnline(html, normalizedQuery)),
    fetchHtml(`https://luarkampus.id/events?month=${currentMonth}`).then((html) => parseLuarKampusCompetitions(html)),
    fetchHtml(`https://luarkampus.id/events?month=${nextMonth}`).then((html) => parseLuarKampusCompetitions(html)),
  ];

  const results = await Promise.allSettled(promises);
  const rawCompetitions: Competition[] = [];

  results.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      if (idx === 0) {
        rawCompetitions.push(...result.value);
      } else {
        const items = result.value;
        if (!normalizedQuery) {
          rawCompetitions.push(...items);
        } else {
          const lowerQ = normalizedQuery.toLowerCase();
          rawCompetitions.push(...items.filter(comp => comp.title.toLowerCase().includes(lowerQ)));
        }
      }
    }
  });

  const uniqueMap = new Map<string, Competition>();
  rawCompetitions.forEach(comp => {
    const titleKey = comp.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
    if (!uniqueMap.has(titleKey)) uniqueMap.set(titleKey, comp);
  });

  return Array.from(uniqueMap.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// HONO Edge Routing (Substitusi Express Total)
// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: { MY_BROWSER: any } }>();

// Pasang CORS bawaan Hono
app.use("*", cors());

// 1. ENDPOINT KILAT LOMBA LOKAL INDONESIA
app.get("/api/competitions", async (c) => {
  try {
    const q = (c.req.query("q") || "").trim();
    const category = c.req.query("category") || "all";
    
    let competitions = await fetchFastSourcesOnly(q);
    if (category !== "all") competitions = competitions.filter((comp) => comp.category === category);
    
    return c.json(competitions.slice(0, 100));
  } catch (error) {
    return c.json({ error: "Failed to fetch competitions." }, 500);
  }
});

// 2. ENDPOINT PUSPRESNAS INSTAN (Native Edge Worker Lifecycle)
app.get("/api/competitions/puspresnas", async (c) => {
  try {
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const category = c.req.query("category") || "all";
    
    // Sekarang c.env.MY_BROWSER sudah aman dari error TypeScript!
    const cloudflareEnv = c.env;

    if (!GLOBAL_CACHE.isPuspresnasReady && cloudflareEnv?.MY_BROWSER) {
      console.log("[Cloudflare Edge] Memicu background scrape...");
      c.executionCtx.waitUntil(warmUpPuspresnasCache(cloudflareEnv));
    }

    let competitions = [...GLOBAL_CACHE.puspresnas];
    if (q) competitions = competitions.filter((comp) => comp.title.toLowerCase().includes(q));
    if (category !== "all") competitions = competitions.filter((comp) => comp.category === category);
    
    return c.json(competitions);
  } catch (error) {
    return c.json({ error: "Failed to fetch Puspresnas data." }, 500);
  }
});

// 3. BATCH ENDPOINT
app.get("/api/competitions/batch", async (c) => {
  try {
    const idsStr = (c.req.query("ids") || "").trim();
    if (!idsStr) return c.json([]);
    const ids = idsStr.split(",").filter(Boolean);
    const allComps = await fetchFastSourcesOnly("");
    return c.json(allComps.filter((comp) => ids.includes(comp.id)));
  } catch (error) {
    return c.json({ error: "Failed to fetch batch." }, 500);
  }
});

// Ekspor default Hono
export default app;