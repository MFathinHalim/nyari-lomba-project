import express from "express";
import path from "path";
import * as cheerio from "cheerio";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import { chromium } from "playwright"; 

// ─────────────────────────────────────────────────────────────────────────────
// Types
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

interface DevpostHackathonRaw {
  id: number;
  title: string;
  tagline?: string;
  url: string;
  is_open?: boolean;
  submission_period_dates?: string; 
  themes?: { name: string }[];
  prize_amount?: string;
  registrations_count?: number;
  featured?: boolean;
  open_state?: string; 
  thumbnail_url?: string; 
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Keywords
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
      timeout: 15000, 
    });
    return response.data;
  } catch (error: any) {
    console.error(`[Scraper Error] Gagal fetch HTML: ${url}. Error: ${error.message}`);
    return ""; 
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scraper Functions
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPuspresnasCompetitions(query: string): Promise<Competition[]> {
  let browser;
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const jenjang of PUSPRESNAS_JENJANGS) {
      const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`;
      
      try {
        await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(1000); 

        const html = await page.content();
        const $ = cheerio.load(html);

        $("div.card").each((_, el) => {
          const card = $(el);
          
          const titleElement = card.find("a.card-title h5, h5");
          const title = titleElement.text().trim();
          
          let detailUrl = card.find("a.card-title").attr("href")?.trim() 
                          || card.find("a:contains('Detail')").attr("href")?.trim() 
                          || targetUrl;

          if (detailUrl && !detailUrl.startsWith("http")) {
            detailUrl = `https://pusatprestasinasional.kemendikdasmen.go.id${detailUrl.startsWith("/") ? "" : "/"}${detailUrl}`;
          }

          if (!title) return;

          let imageUrl = card.find("img.card-img-top").attr("src")?.trim() || "";
          if (imageUrl && !imageUrl.startsWith("http")) {
            imageUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/${imageUrl.replace(/^\//, "")}`;
          }

          const categoryTag = card.find("span.badge-orange").text().trim() || "Ajang Talenta";
          
          const deadlineText = card.find("span.badge-gray:has(i.fa-calendar-day)").text().trim() 
                               || card.find("span.badge-gray").first().text().trim() 
                               || "Lihat Panduan";
          
          const cleanedDeadline = deadlineText.replace(/[\n\t]/g, "").trim();
          const id = normalizeId(detailUrl, `puspresnas-${jenjang}`);
          const tingkatText = card.find("span.badge-gray:has(i.fa-flag)").text().trim() || "Nasional";

          const description = `Kompetisi Resmi Puspresnas Jenjang ${jenjang.toUpperCase()} - Kemendikdasmen RI. Tingkat ${tingkatText}.`;

          const competition = normalizeCompetition({
            id,
            title,
            shortDescription: description,
            url: detailUrl,
            source: `Puspresnas (${jenjang.toUpperCase()})`,
            deadline: cleanedDeadline,
            category: guessCategory(title) || categoryTag,
            tags: ["Puspresnas", "Kemendikdasmen", jenjang.toUpperCase()],
            isUpcoming: true,
            imageUrl
          });

          if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery)) {
            if (!competitions.some(c => c.id === competition.id)) {
              competitions.push(competition);
            }
          }
        });

      } catch (jenjangErr: any) {
        console.error(`[Puspresnas] Gagal ambil jenjang ${jenjang}:`, jenjangErr.message);
        continue; 
      }
    }

    return competitions;
  } catch (err: any) {
    console.error("[Puspresnas Headless Server Error]:", err.message);
    return [];
  } finally {
    if (browser) await browser.close(); 
  }
}

async function fetchDevpostCompetitions(query: string): Promise<Competition[]> {
  try {
    const params = new URLSearchParams({
      challenge_type: "all",
      order_by: "recently-added",
      page: "1",
    });
    if (query) params.set("search", query);

    const url = `https://devpost.com/hackathons.json?${params.toString()}`;
    
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://devpost.com/hackathons",
      },
      timeout: 10000
    });

    const data = res.data;
    const hackathons: DevpostHackathonRaw[] = data?.hackathons ?? [];

    return hackathons.slice(0, 30).map((h): Competition => {
      const tags = (h.themes ?? []).map((t) => t.name).filter(Boolean);
      const raw = `${h.title} ${h.tagline ?? ""} ${tags.join(" ")}`;
      const deadlineRaw = h.submission_period_dates?.split(" - ").pop()?.trim() ?? "TBA";

      return normalizeCompetition({
        id: normalizeId(h.url, "devpost"),
        title: h.title,
        shortDescription: h.tagline || "Hackathon listed on Devpost.",
        url: h.url,
        source: "Devpost",
        deadline: deadlineRaw,
        category: guessCategory(raw),
        tags: tags.slice(0, 10),
        isUpcoming: h.open_state !== "ended",
        imageUrl: h.thumbnail_url || "", 
      });
    });
  } catch (err: any) {
    console.error("[Devpost Error] Gagal ambil data Devpost:", err.message);
    return []; 
  }
}

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

    const onClickAttr = anchor.attr("onclick")?.trim() || "";
    let finalUrl = "";

    const match = onClickAttr.match(/loadDetailsEvent\s*\(\s*(\d+)\s*,\s*['"]([^'"]+)['"]/);
    if (match && match[1] && match[2]) {
      finalUrl = `${baseUrl}/info-${match[2]}-${match[1]}`;
    } else {
      let href = anchor.attr("href")?.trim() || "";
      if (href && !href.startsWith("javascript:") && href !== "#") {
        finalUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
      }
    }

    if (!finalUrl) return;

    const id = normalizeId(finalUrl, "infolomba");
    const imgEl = container.find(".img-container img").first();
    let imageUrl = imgEl.attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = imageUrl.startsWith("/") ? `${baseUrl}${imageUrl}` : `${baseUrl}/${imageUrl}`;
    }

    const targetText = container.find(".target").text().trim(); 
    const biayaText = container.find(".biaya").text().trim();   
    const lokasiText = container.find(".lokasi").text().trim(); 
    const tanggalText = container.find(".tanggal").text().trim(); 
    const penyelenggara = container.find(".penyelenggara div span").not(".subtitle").text().trim();

    const description = `Penyelenggara: ${penyelenggara || "TBA"}. Target Peserta: ${targetText}. Biaya: ${biayaText}. Location: ${lokasiText}.`;

    let deadline = "TBA";
    if (tanggalText) {
      const dateParts = tanggalText.split("-");
      deadline = dateParts.length > 1 ? dateParts[1].trim() : tanggalText;
    }

    const tagSet = new Set<string>();
    if (targetText) targetText.split(",").forEach(t => { if (t.trim()) tagSet.add(t.trim()); });
    if (lokasiText) tagSet.add(lokasiText);
    if (biayaText.toLowerCase().includes("gratis") || biayaText.includes("Rp 0")) tagSet.add("Gratis");

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: description,
      url: finalUrl,
      source: "InfoLomba",
      deadline,
      category: guessCategory(`${title} ${description}`),
      tags: Array.from(tagSet).slice(0, 10),
      isUpcoming: !container.hasClass("event-past"),
      imageUrl, 
    });

    if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery)) {
      competitions.push(competition);
    }
  });

  return competitions;
}

function parseLuarKampusCompetitions(html: string, query: string): Competition[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();
  const baseUrl = "https://luarkampus.id";

  $("a[href*='/events/']").each((_, el) => {
    const card = $(el);
    const title = card.find("p.font-bold").text().trim();
    if (!title) return;

    let href = card.attr("href")?.trim() || "";
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
    const id = normalizeId(detailUrl, "luarkampus");

    let imageUrl = card.find("img[src*='/storage/event/']").attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `${baseUrl}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
    }

    const penyelenggara = card.find(".text-gray-700 span").eq(0).text().trim();
    const tingkat = card.find(".text-gray-700 span").eq(1).text().trim();
    const lokasi = card.find(".text-gray-700 div.flex.items-center span").text().trim();

    const description = `Penyelenggara: ${penyelenggara || "TBA"}. Tingkat: ${tingkat || "Umum"}. Lokasi: ${lokasi || "Indonesia"}.`;

    const tagSet = new Set<string>();
    card.find("span.bg-success").each((_, tagEl) => {
      const tagText = $(tagEl).text().trim();
      if (tagText && tagText !== "9+") tagSet.add(tagText);
    });

    if (lokasi) tagSet.add(lokasi);
    if (tingkat.toLowerCase().includes("fully funded") || tingkat.toLowerCase().includes("gratis")) tagSet.add("Gratis");

    const deadlineContainer = card.find("span.text-red-600");
    let deadline = "TBA";
    if (deadlineContainer.length > 0) {
      deadline = deadlineContainer.find("b").text().trim() || deadlineContainer.text().replace("Deadline:", "").trim();
    }

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: description,
      url: detailUrl,
      source: "LuarKampus",
      deadline,
      category: guessCategory(`${title} ${description}`),
      tags: Array.from(tagSet),
      isUpcoming: true, 
      imageUrl,
    });

    if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery)) {
      competitions.push(competition);
    }
  });

  return competitions;
}

function parseKompetisiCoIdCompetitions(html: string, query: string): Competition[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();
  const baseUrl = "https://kompetisi.co.id";

  $(".group.bg-white").each((_, el) => {
    const card = $(el);
    const title = card.find("h3").text().trim();
    if (!title) return;

    const registrationAnchor = card.find("a[href*='kompetisi?id=']").first();
    let href = registrationAnchor.attr("href")?.trim() || "";
    if (!href) return;
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}/${href}`;
    const id = normalizeId(detailUrl, "kompetisicoid");

    const posterButtonOnclick = card.find("button[onclick*='openPoster']").attr("onclick") || "";
    let imageUrl = "";
    const posterMatch = posterButtonOnclick.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/);
    if (posterMatch && posterMatch[1]) {
      imageUrl = posterMatch[1].startsWith("http") ? posterMatch[1] : `${baseUrl}/${posterMatch[1]}`;
    }

    const tags: string[] = [];
    card.find("span.rounded-md").each((_, tagEl) => {
      const tagText = $(tagEl).text().trim();
      if (tagText) tags.push(tagText);
    });

    let deadline = "TBA";
    card.find(".flex.justify-between.items-center").each((_, scheduleEl) => {
      const phaseName = $(scheduleEl).find("span").eq(0).text().trim().toLowerCase();
      const phaseDate = $(scheduleEl).find("span").eq(1).text().trim();
      if (phaseName.includes("final") || phaseName.includes("penyisihan") || phaseName.includes("deadline")) {
        deadline = phaseDate;
      }
    });

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: `Kompetisi Terkurasi oleh Kompetisi.co.id.`,
      url: detailUrl,
      source: "Kompetisi.co.id",
      deadline,
      category: guessCategory(`${title} ${tags.join(" ")}`),
      tags,
      isUpcoming: true,
      imageUrl,
    });

    if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery)) {
      competitions.push(competition);
    }
  });

  return competitions;
}

function parseKompetisiOnline(html: string, query: string): Competition[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();
  const baseUrl = "https://kompetisionline.com";

  $("a[href*='?id=']").each((_, el) => {
    const anchor = $(el);
    const title = anchor.find("h3, h4, p").first().text().trim() || anchor.text().trim();
    if (!title || title.length < 5 || title.toLowerCase().includes("selengkapnya")) return;

    let href = anchor.attr("href")?.trim() || "";
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}/${href.replace(/^\//, "")}`;
    const id = normalizeId(detailUrl, "kompetisionline");

    const parentCard = anchor.closest("div[class*='card'], div[class*='box'], .portfolio-item");
    let imageUrl = parentCard.find("img").first().attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `${baseUrl}/${imageUrl.replace(/^\//, "")}`;
    }

    const tags: string[] = [];
    parentCard.find("span, .badge").each((_, badgeEl) => {
      const tagText = $(badgeEl).text().trim();
      if (tagText && tagText.length < 20) tags.push(tagText);
    });

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: `Info lomba terupdate via KompetisiOnline.com.`,
      url: detailUrl,
      source: "KompetisiOnline",
      deadline: "Lihat di Web", 
      category: guessCategory(`${title} ${tags.join(" ")}`),
      tags: tags.length > 0 ? tags : ["Competitions"],
      isUpcoming: true,
      imageUrl,
    });

    if (!lowerQuery || competition.title.toLowerCase().includes(lowerQuery)) {
      competitions.push(competition);
    }
  });

  return competitions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator (Hanya Sumber Cepat)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFastSourcesOnly(query: string): Promise<Competition[]> {
  const normalizedQuery = query.trim();
  const encodedQuery = encodeURIComponent(normalizedQuery);

  const infolombaUrl = normalizedQuery
    ? `https://www.infolomba.id/events?sort=Default&title=${encodedQuery}+&peserta=Semua+Peserta&lokasi=Semua+Lokasi&kategori=Semua+Kategori`
    : "https://www.infolomba.id/events";

  const currentMonth = new Date().getMonth() + 1; 
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const luarkampusUrls = [
    `https://luarkampus.id/events?month=${currentMonth}`,
    `https://luarkampus.id/events?month=${nextMonth}`
  ];

  const kompetisiCoIdP1 = normalizedQuery ? `https://kompetisi.co.id/?page=1&q=${encodedQuery}` : "https://kompetisi.co.id/?page=1";
  const kompetisiCoIdP2 = normalizedQuery ? `https://kompetisi.co.id/?page=2&q=${encodedQuery}` : "https://kompetisi.co.id/?page=2";

  const kompetisiOnlineP1 = `https://kompetisionline.com/?page=1&q=${encodedQuery}`;
  const kompetisiOnlineP2 = `https://kompetisionline.com/?page=2&q=${encodedQuery}`;

  const promises: Promise<Competition[]>[] = [
    fetchDevpostCompetitions(normalizedQuery), 
    fetchHtml(infolombaUrl).then((html) => parseInfoLombaCompetitions(html, normalizedQuery)),
    fetchHtml(kompetisiCoIdP1).then((html) => parseKompetisiCoIdCompetitions(html, normalizedQuery)),
    fetchHtml(kompetisiCoIdP2).then((html) => parseKompetisiCoIdCompetitions(html, normalizedQuery)),
    fetchHtml(kompetisiOnlineP1).then((html) => parseKompetisiOnline(html, normalizedQuery)),
    fetchHtml(kompetisiOnlineP2).then((html) => parseKompetisiOnline(html, normalizedQuery)),
  ];

  luarkampusUrls.forEach(url => {
    promises.push(fetchHtml(url).then((html) => parseLuarKampusCompetitions(html, normalizedQuery)));
  });

  const results = await Promise.allSettled(promises);
  const competitions: Competition[] = [];

  results.forEach((result) => {
    if (result.status === "fulfilled") competitions.push(...result.value);
  });

  const uniqueMap = new Map<string, Competition>();
  competitions.forEach(comp => {
    const titleKey = comp.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
    if (!uniqueMap.has(titleKey)) uniqueMap.set(titleKey, comp);
  });

  return Array.from(uniqueMap.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Express Server Execution
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. ENDPOINT CEPAT: Untuk 5 website standar (< 1 detik)
  app.get("/api/competitions", async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      const category = (req.query.category as string) || "all";

      let competitions = await fetchFastSourcesOnly(q);

      if (category !== "all") {
        competitions = competitions.filter((c) => c.category === category);
      }

      res.json(competitions.slice(0, 100)); 
    } catch (error: any) {
      console.error("Error fetching fast competitions:", error);
      res.status(500).json({ error: "Failed to fetch competitions." });
    }
  });

  // 2. ENDPOINT LALOT JALUR TERPISAH: Khusus melayani Headless Puspresnas
  app.get("/api/competitions/puspresnas", async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      const category = (req.query.category as string) || "all";

      let competitions = await fetchPuspresnasCompetitions(q);

      if (category !== "all") {
        competitions = competitions.filter((c) => c.category === category);
      }

      res.json(competitions);
    } catch (error: any) {
      console.error("Error fetching Puspresnas route:", error);
      res.status(500).json({ error: "Failed to fetch Puspresnas data." });
    }
  });

  app.get("/api/competitions/batch", async (req, res) => {
    try {
      const idsStr = (req.query.ids as string || "").trim();
      if (!idsStr) return res.json([]);

      const ids = idsStr.split(",").filter(Boolean);
      const allComps = await fetchFastSourcesOnly("");
      const filtered = allComps.filter((c) => ids.includes(c.id));

      res.json(filtered);
    } catch (error: any) {
      console.error("Error fetching batch competitions:", error);
      res.status(500).json({ error: "Failed to fetch batch competitions." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();