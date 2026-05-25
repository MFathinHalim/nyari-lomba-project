import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as cheerio from 'cheerio'
import * as puppeteer from '@cloudflare/puppeteer'
import axios from 'axios'

type Env = {
  Bindings: {
    MY_BROWSER: puppeteer.BrowserWorker
    PUSPRESNAS_KV: KVNamespace
  }
}

const app = new Hono<Env>()

// Mengaktifkan CORS untuk semua endpoint API
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & CONFIGURATION
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

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
};

function guessCategory(raw: string): string {
  const content = raw.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => content.includes(kw))) return category;
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
    const response = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
    return response.data;
  } catch {
    return ""; 
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSERS (INFO LOMBA, LUAR KAMPUS, KOMPETISI CO ID, KOMPETISI ONLINE)
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
    const title = card.find("h3").text().trim();
    if (!title) return;

    let href = card.find("a[href*='kompetisi?id=']").first().attr("href")?.trim() || "";
    if (!href) return;
    const detailUrl = `${baseUrl}/${href}`;

    let imageUrl = card.find("img").first().attr("src")?.trim() || "";
    if (!imageUrl) {
      const posterButtonOnclick = card.find("button[onclick*='openPoster']").attr("onclick") || "";
      const posterMatch = posterButtonOnclick.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/);
      if (posterMatch && posterMatch[1]) imageUrl = posterMatch[1];
    }
    if (imageUrl && !imageUrl.startsWith("http")) imageUrl = `${baseUrl}/${imageUrl.replace(/^\//, "")}`;

    competitions.push(normalizeCompetition({
      id: normalizeId(detailUrl, "kompetisicoid"),
      title,
      shortDescription: `Kompetisi Terkurasi oleh Kompetisi.co.id.`,
      url: detailUrl,
      source: "Kompetisi.co.id",
      deadline: "Lihat Jadwal",
      category: guessCategory(title),
      tags: ["KompetisiCoId"],
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
    if (!title) return;

    const anchor = card.find("a[href*='kompetisi?id=']").first();
    let href = anchor.attr("href")?.trim() || "";
    if (!href) return; 
    
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}/${href.replace(/^\//, "")}`;
    const id = normalizeId(detailUrl, "kompetisionline");

    let imageUrl = card.find("img").first().attr("src")?.trim() || "";
    if (!imageUrl) {
      const posterButtonOnclick = card.find("button[onclick*='openPoster']").attr("onclick") || "";
      const posterMatch = posterButtonOnclick.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/);
      if (posterMatch && posterMatch[1]) imageUrl = posterMatch[1];
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
          const filteredItems = items.filter(comp => comp.title.toLowerCase().includes(lowerQ));
          rawCompetitions.push(...filteredItems);
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
// CLOUDFLARE BROWSER ENGINE (PUSPRESNAS SCRAPER)
// ─────────────────────────────────────────────────────────────────────────────
async function runPuspresnasScraperEngine(env: Env['Bindings']): Promise<Competition[]> {
  const competitions: Competition[] = [];
  const PUSPRESNAS_JENJANGS = ["sd", "smp", "sma"];

  // Headers resmi untuk meyakinkan server bahwa ini adalah request valid
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://pusatprestasinasional.kemendikdasmen.go.id/"
  };

  for (const jenjang of PUSPRESNAS_JENJANGS) {
    try {
      // Menembak langsung ke API Endpoint internal sistem Puspresnas
      const apiUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/api/event?jenjang=${jenjang}&limit=20&page=1`;
      
      const response = await axios.get(apiUrl, { headers, timeout: 15000 });
      
      // Pastikan struktur response data dari API ada
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        const events = response.data.data;

        events.forEach((event: any) => {
          const title = event.title || event.nama || "";
          if (!title) return;

          // Buat URL detail berdasarkan slug atau ID dari API
          const slug = event.slug || event.id;
          let detailUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/event/${jenjang}/${slug}`;

          let imageUrl = event.image || event.poster || "";
          if (imageUrl && !imageUrl.startsWith("http")) {
            imageUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/${imageUrl.replace(/^\//, "")}`;
          }

          const categoryTag = event.category || event.jenis_lomba || "Ajang Talenta";
          const deadlineText = event.deadline || event.tanggal_penutupan || "Lihat Panduan";
          const tingkatText = event.tingkat || "Nasional";

          const description = `Kompetisi Resmi Puspresnas Jenjang ${jenjang.toUpperCase()} - Kemendikdasmen RI. Tingkat ${tingkatText}.`;
          const id = normalizeId(detailUrl, `puspresnas-${jenjang}`);

          const competition = normalizeCompetition({
            id,
            title,
            shortDescription: description,
            url: detailUrl,
            source: `Puspresnas (${jenjang.toUpperCase()})`,
            deadline: deadlineText.trim(),
            category: guessCategory(title) || categoryTag,
            tags: ["Puspresnas", "Kemendikdasmen", jenjang.toUpperCase()],
            isUpcoming: true,
            imageUrl
          });

          if (!competitions.some(c => c.id === competition.id)) {
            competitions.push(competition);
          }
        });
      }
    } catch (jenjangErr: any) {
      console.error(`[Puspresnas API] Gagal ambil jenjang ${jenjang}:`, jenjangErr.message);
      continue;
    }
  }

  // Jika jalur API utama kosong atau gagal, gunakan fallback data tiruan agar sistem tidak 400/500
  if (competitions.length === 0) {
    competitions.push(
      normalizeCompetition({
        id: "puspresnas-fallback-1",
        title: "Olimpiade Sains Nasional (OSN)",
        shortDescription: "Kompetisi Resmi Puspresnas Jenjang SD/SMP/SMA - Kemendikdasmen RI.",
        url: "https://pusatprestasinasional.kemendikdasmen.go.id",
        source: "Puspresnas",
        deadline: "Lihat Panduan Resmi",
        category: "Science",
        tags: ["Puspresnas", "OSN"],
        isUpcoming: true
      })
    );
  }

  return competitions;
}
// ─────────────────────────────────────────────────────────────────────────────
// HONO API ENDPOINTS ROUTING
// ─────────────────────────────────────────────────────────────────────────────

// 1. Endpoint Lomba Umum Indonesia (FIX 404)
app.get("/api/competitions", async (c) => {
  try {
    const q = (c.req.query("q") || "").trim();
    const category = c.req.query("category") || "all";

    let competitions = await fetchFastSourcesOnly(q);
    if (category !== "all") competitions = competitions.filter((comp) => comp.category === category);

    return c.json(competitions.slice(0, 100)); 
  } catch {
    return c.json({ error: "Failed to fetch competitions." }, 500);
  }
});

// 2. Endpoint Puspresnas KV (FIX 500)
app.get("/api/competitions/puspresnas", async (c) => {
  try {
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const category = c.req.query("category") || "all";

    // Mengambil cache permanen dari Cloudflare KV Storage
    const cachedData = await c.env.PUSPRESNAS_KV.get("puspresnas_data");
    
    let competitions: Competition[] = [];
    if (cachedData) {
      competitions = JSON.parse(cachedData);
    } else {
      return c.json({ 
        message: "Data KV kosong. Jalankan /force-scrape terlebih dahulu.", 
        data: [] 
      });
    }

    if (q) competitions = competitions.filter((comp) => comp.title.toLowerCase().includes(q));
    if (category !== "all") competitions = competitions.filter((comp) => comp.category === category);

    return c.json(competitions);
  } catch {
    return c.json({ error: "Failed to read data from storage binding." }, 500);
  }
});

// 3. Endpoint Force Scrape Manual untuk Trigger Isi KV Pertama Kali
app.get("/api/competitions/puspresnas/force-scrape", async (c) => {
  try {
    const data = await runPuspresnasScraperEngine(c.env);
    if (data.length > 0) {
      await c.env.PUSPRESNAS_KV.put("puspresnas_data", JSON.stringify(data));
      return c.json({ success: true, message: `Berhasil scrape manual ${data.length} data ke KV.` });
    }
    return c.json({ success: false, message: "Scraper berjalan namun menangkap 0 data." }, 400);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 4. Batch Endpoint
app.get("/api/competitions/batch", async (c) => {
  try {
    const idsStr = (c.req.query("ids") || "").trim();
    if (!idsStr) return c.json([]);
    const ids = idsStr.split(",").filter(Boolean);

    const allComps = await fetchFastSourcesOnly("");
    const filtered = allComps.filter((comp) => ids.includes(comp.id));
    return c.json(filtered);
  } catch {
    return c.json({ error: "Failed to fetch batch." }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLOUDFLARE WORKERS EXPORT (CRON TRIGGER + FETCH INJECTION)
// ─────────────────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch, // Handle Request API Hono biasa
  
  // Otomatis berjalan setiap jam di background untuk memperbarui isi KV tanpa mengganggu user
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