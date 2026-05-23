import express from "express";
import path from "path";
import * as cheerio from "cheerio";
import { createServer as createViteServer } from "vite";
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

// Wadah penyimpanan data Puspresnas di RAM biar cukup di-parse sekali pas startup
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
// Robust Puspresnas RAM Cache Warmup (Cukup Sekali Eksekusi)
// ─────────────────────────────────────────────────────────────────────────────

async function warmUpPuspresnasCache(): Promise<void> {
  let browser;
  const competitions: Competition[] = [];
  console.log("[Cache] Memulai pengambilan data Puspresnas Kemendikdasmen (Sekali jalan)...");

  try {
    // Membuka Chromium dengan parameter anti-detection bot
    browser = await chromium.launch({ 
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    });
    
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();

    for (const jenjang of PUSPRESNAS_JENJANGS) {
      const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`;
      try {
        console.log(`[Cache] Sedang merayap jenjang: ${jenjang.toUpperCase()}...`);
        
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        
        // Jeda ekstra 3 detik biar Client-side JS rendering bawaan webnya selesai sempurna
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

        console.log(`[Cache Success] Berhasil mengambil ${countPerJenjang} lomba dari jenjang ${jenjang.toUpperCase()}`);
        
        // Jeda nafas 4 detik antar-jenjang biar tidak memicu block / rate limit server
        await delay(4000);

      } catch (e: any) {
        console.error(`[Cache Error] Gagal merayap jenjang ${jenjang}. Pesan: ${e.message}`);
        continue;
      }
    }
    
    GLOBAL_CACHE.puspresnas = competitions;
    GLOBAL_CACHE.isPuspresnasReady = true;
    console.log(`[Cache Ready] Database Puspresnas sukses dikunci ke RAM: ${competitions.length} event.`);
  } catch (err) {
    console.error("[Cache Error] Gagal total memuat Puspresnas di awal:", err);
  } finally {
    if (browser) await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Parsers (Murni Parse Sesuai Struktur Asli Web)
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

  // Sesuai HTML: Setiap kartu dibungkus oleh elemen class '.group.bg-white'
  $(".group.bg-white").each((_, el) => {
    const card = $(el);
    
    // 1. Ambil Judul Lomba dari elemen h3
    let title = card.find("h3").text().trim();
    // Hilangkan teks tambahan seperti (INFINIBEE ) jika ada di dalam span bawaan judul
    card.find("h3 span").each((_, spanEl) => {
      const spanText = $(spanEl).text();
      title = title.replace(spanText, "").trim();
    });
    
    if (!title) return;

    // 2. Ambil Link Detail dari a[href*='kompetisi?id=']
    const anchor = card.find("a[href*='kompetisi?id=']").first();
    let href = anchor.attr("href")?.trim() || "";
    if (!href) return; // Jika tidak ada link pendaftaran/detail, lewati
    
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}/${href.replace(/^\//, "")}`;
    const id = normalizeId(detailUrl, "kompetisionline");

    // 3. Ambil Gambar / Poster (Prioritaskan logo, fallback ke parameter openPoster jika ada)
    let imageUrl = card.find("img").first().attr("src")?.trim() || "";
    if (!imageUrl) {
      const posterButtonOnclick = card.find("button[onclick*='openPoster']").attr("onclick") || "";
      const posterMatch = posterButtonOnclick.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/);
      if (posterMatch && posterMatch[1]) imageUrl = posterMatch[1];
    }
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `${baseUrl}/${imageUrl.replace(/^\//, "")}`;
    }

    // 4. Ekstraksi Tags/Kategori (LVL. Advanced, Nasional, Online, dll)
    const tags: string[] = [];
    card.find("span").each((_, badgeEl) => {
      const tagText = $(badgeEl).text().trim();
      // Filter teks tanggal atau sub-batch agar tidak masuk ke tags kategori utama
      if (tagText && tagText.length < 20 && !/2026|Penyisihan|Final|Batch/i.test(tagText)) {
        tags.push(tagText);
      }
    });

    // 5. Ambil info Jadwal/Deadline jika tersedia (opsional untuk akurasi data)
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

    // 6. Filter pencarian kata kunci internal
    if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery) || tags.some(t => t.toLowerCase().includes(lowerQuery))) {
      competitions.push(competition);
    }
  });

  return competitions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator (InfoLomba Live Search + Sisa Web Ambil Utama & Filter RAM)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFastSourcesOnly(query: string): Promise<Competition[]> {
  const normalizedQuery = query.trim();
  const encodedQuery = encodeURIComponent(normalizedQuery);

  // InfoLomba ditembak langsung lewat query parameter bawaan webnya
  const infolombaUrl = normalizedQuery
    ? `https://www.infolomba.id/events?sort=Default&title=${encodedQuery}`
    : "https://www.infolomba.id/events";

  const currentMonth = new Date().getMonth() + 1; 
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;

  // Web selain InfoLomba ditembak murni halaman utamanya (lengkap tanpa error query)
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
        // InfoLomba (sudah bersih karena disaring dari server infolomba langsung)
        rawCompetitions.push(...result.value);
      } else {
        // Sisa Web statis disaring manual lewat judul di memori RAM backend
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

  // Pembersihan duplikasi data kembar berdasarkan manipulasi kemiripan judul
  const uniqueMap = new Map<string, Competition>();
  rawCompetitions.forEach(comp => {
    const titleKey = comp.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
    if (!uniqueMap.has(titleKey)) uniqueMap.set(titleKey, comp);
  });

  return Array.from(uniqueMap.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Express Server & Endpoints Execution
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  // 1. ENDPOINT KILAT LOMBA LOKAL INDONESIA
  app.get("/api/competitions", async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      const category = (req.query.category as string) || "all";

      let competitions = await fetchFastSourcesOnly(q);
      if (category !== "all") competitions = competitions.filter((c) => c.category === category);

      res.json(competitions.slice(0, 100)); 
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch competitions." });
    }
  });

  // 2. ENDPOINT PUSPRESNAS INSTAN (Bebas Lag karena memotong data RAM Cache)
  app.get("/api/competitions/puspresnas", async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim().toLowerCase();
      const category = (req.query.category as string) || "all";

      let competitions = [...GLOBAL_CACHE.puspresnas];

      // Saring query pencarian internal RAM jika user mengetik kata kunci
      if (q) {
        competitions = competitions.filter((c) => c.title.toLowerCase().includes(q));
      }
      
      if (category !== "all") {
        competitions = competitions.filter((c) => c.category === category);
      }

      res.json(competitions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Puspresnas data." });
    }
  });

  // 3. BATCH ENDPOINT
  app.get("/api/competitions/batch", async (req, res) => {
    try {
      const idsStr = (req.query.ids as string || "").trim();
      if (!idsStr) return res.json([]);
      const ids = idsStr.split(",").filter(Boolean);

      const allComps = await fetchFastSourcesOnly("");
      const filtered = allComps.filter((c) => ids.includes(c.id));
      res.json(filtered);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch batch." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // AUTOMATIC BACKDROP WARMUP: Berjalan otomatis sekali di awal startup server
    warmUpPuspresnasCache();
  });
}

startServer();