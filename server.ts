import express from "express";
import path from "path";
import * as cheerio from "cheerio";
import { createServer as createViteServer } from "vite";
import axios from "axios";

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
  Arts: ["design", "art", "creative", "illustration", "visual", "film", "festival", "movie", "video", "sinematografi", "foto", "photography", "poster", "lukis", "gambar", "musik", "lagu"],
  Science: ["science", "tech", "technology", "research", "innovation", "sains", "matematika", "fisika", "biologi", "kimia", "olimpiade", "riset", "karya tulis", "kti"],
  "E-Sports": ["esports", "gaming", "valorant", "mlbb", "mobile legends", "game", "turnamen", "tournament", "pubg"],
  Writing: ["writing", "cerpen", "essay", "story", "literature", "poetry", "menulis", "esai", "puisi", "sastra", "novel"],
  IT: ["hackathon", "software", "developer", "web", "app", "blockchain", "programming", "coding", "ui/ux", "cyber", "data science", "ai", "cloud"],
};

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
};

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
// Devpost Scraper
// ─────────────────────────────────────────────────────────────────────────────

async function fetchDevpostCompetitions(query: string): Promise<Competition[]> {
  try {
    const params = new URLSearchParams({
      challenge_type: "all",
      order_by: "recently-added",
      page: "1",
    });
    if (query) params.set("search", query);

    const url = `https://devpost.com/hackathons.json?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
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
  } catch (err) {
    console.error("Devpost fetch error:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// InfoLomba Real Scraper
// ─────────────────────────────────────────────────────────────────────────────

function parseInfoLombaCompetitions(html: string, query: string): Competition[] {
  if (!html) return [];
  
  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();
  const baseUrl = "https://www.infolomba.id";

  const containers = $(".event-container").toArray();

  containers.forEach((el) => {
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

    const description = `Penyelenggara: ${penyelenggara || "TBA"}. Target Peserta: ${targetText}. Biaya: ${biayaText}. Lokasi: ${lokasiText}.`;

    let deadline = "TBA";
    if (tanggalText) {
      const dateParts = tanggalText.split("-");
      deadline = dateParts.length > 1 ? dateParts[1].trim() : tanggalText;
    }

    const tagSet = new Set<string>();
    if (targetText) {
      targetText.split(",").forEach((t) => {
        const cleaned = t.trim();
        if (cleaned) tagSet.add(cleaned);
      });
    }
    if (lokasiText) tagSet.add(lokasiText);
    if (biayaText.toLowerCase().includes("gratis") || biayaText.includes("Rp 0")) {
      tagSet.add("Gratis");
    }

    const tags = Array.from(tagSet).slice(0, 10);
    const isPastEvent = container.hasClass("event-past");

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: description,
      url: finalUrl,
      source: "InfoLomba",
      deadline,
      category: guessCategory(`${title} ${description}`),
      tags,
      isUpcoming: !isPastEvent,
      imageUrl, 
    });

    if (
      !lowerQuery ||
      competition.title.toLowerCase().includes(lowerQuery) ||
      competition.shortDescription.toLowerCase().includes(lowerQuery) ||
      competition.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    ) {
      competitions.push(competition);
    }
  });

  return competitions;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW FEATURE: LuarKampus Scraper & Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseLuarKampusCompetitions(html: string, query: string): Competition[] {
  if (!html) return [];

  const $ = cheerio.load(html);
  const competitions: Competition[] = [];
  const lowerQuery = query.toLowerCase();
  const baseUrl = "https://luarkampus.id";

  // Ambil semua elemen anchor <a> yang mengarah ke link events di dalam list
  $("a[href*='/events/']").each((_, el) => {
    const card = $(el);
    
    // 1. Ambil Judul
    const title = card.find("p.font-bold").text().trim();
    if (!title) return;

    // 2. Ambil URL Detail Utama & Gambar Poster
    let href = card.attr("href")?.trim() || "";
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
    const id = normalizeId(detailUrl, "luarkampus");

    let imageUrl = card.find("img[src*='/storage/event/']").attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `${baseUrl}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
    }

    // 3. Ekstrak Meta Informasi (Penyelenggara, Tingkat, Lokasi)
    const penyelenggara = card.find(".text-gray-700 span").eq(0).text().trim();
    const tingkat = card.find(".text-gray-700 span").eq(1).text().trim();
    const lokasi = card.find(".text-gray-700 div.flex.items-center span").text().trim();

    const description = `Penyelenggara: ${penyelenggara || "TBA"}. Tingkat: ${tingkat || "Umum"}. Lokasi: ${lokasi || "Indonesia"}.`;

    // 4. Ekstrak Target Peserta (Teks SMP, SMA, D1, dsb yang ada di bulatan kecil kiri atas)
    const tagSet = new Set<string>();
    card.find("span.bg-success").each((_, tagEl) => {
      const tagText = $(tagEl).text().trim();
      if (tagText && tagText !== "9+") tagSet.add(tagText);
    });

    if (lokasi) tagSet.add(lokasi);
    if (tingkat.toLowerCase().includes("fully funded") || tingkat.toLowerCase().includes("gratis")) {
      tagSet.add("Gratis");
    }
    const tags = Array.from(tagSet);

    // 5. Ekstrak Batas Waktu (Deadline)
    // Mencari baris teks berisikan "Deadline:"
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
      category: guessCategory(`${title} ${description} ${tags.join(" ")}`),
      tags,
      isUpcoming: true, // Berhubung diambil dari kalender aktif bulanan, status default true
      imageUrl,
    });

    // 6. Filter Pencarian Lokal LuarKampus
    if (
      !lowerQuery ||
      competition.title.toLowerCase().includes(lowerQuery) ||
      competition.shortDescription.toLowerCase().includes(lowerQuery) ||
      competition.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    ) {
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

  // Selector induk card utama pembungkus list
  $(".group.bg-white.rounded-\\[clamp\\(1rem\\,2vw\\,1\\.75rem\\)\\]").each((_, el) => {
    const card = $(el);

    // 1. Ekstrak Judul Utama
    const title = card.find("h3").text().trim();
    if (!title) return;

    // 2. Ekstrak Link Registrasi / Detail Halaman
    const registrationAnchor = card.find("a[href*='kompetisi?id=']").first();
    let href = registrationAnchor.attr("href")?.trim() || "";
    if (!href) return;
    const detailUrl = href.startsWith("http") ? href : `${baseUrl}/${href}`;
    const id = normalizeId(detailUrl, "kompetisicoid");

    // 3. FIXED REGEX POSTER: Mengambil path gambar langsung dari script onclick milik button
    const posterButtonOnclick = card.find("button[onclick*='openPoster']").attr("onclick") || "";
    let imageUrl = "";
    const posterMatch = posterButtonOnclick.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/);
    if (posterMatch && posterMatch[1]) {
      const posterPath = posterMatch[1]; // Contoh: assets/poster/poster_1777989498.svg
      imageUrl = posterPath.startsWith("http") ? posterPath : `${baseUrl}/${posterPath}`;
    }

    // 4. Ekstrak Tags (LVL, Wilayah, Sistem Pelaksanaan)
    const tags: string[] = [];
    card.find("span.rounded-md").each((_, tagEl) => {
      const tagText = $(tagEl).text().trim();
      if (tagText) tags.push(tagText);
    });

    // 5. Ekstrak Jadwal & Deadline Kegiatan
    let deadline = "TBA";
    card.find(".flex.justify-between.items-center").each((_, scheduleEl) => {
      const phaseName = $(scheduleEl).find("span").eq(0).text().trim().toLowerCase();
      const phaseDate = $(scheduleEl).find("span").eq(1).text().trim();
      
      // Menggunakan penanda Final atau Penyisihan sebagai penentu batas deadline pengumpulan terdekat
      if (phaseName.includes("final") || phaseName.includes("penyisihan") || phaseName.includes("deadline")) {
        deadline = phaseDate;
      }
    });

    const batchText = card.find("p.tracking-\\[0\\.2em\\]").text().trim() || "";
    const description = `Kompetisi Terkurasi oleh Kompetisi.co.id. ${batchText ? `Edisi: ${batchText}.` : ""}`;

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: description,
      url: detailUrl,
      source: "Kompetisi.co.id",
      deadline,
      category: guessCategory(`${title} ${tags.join(" ")}`),
      tags,
      isUpcoming: true,
      imageUrl,
    });

    // 6. Filter Pencarian Lokal internal memori
    if (
      !lowerQuery ||
      competition.title.toLowerCase().includes(lowerQuery) ||
      competition.shortDescription.toLowerCase().includes(lowerQuery) ||
      competition.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    ) {
      competitions.push(competition);
    }
  });

  return competitions;
}
// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator (Penggabung 3 Sumber Sekaligus)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCompetitionsFromSources(
  query: string,
  _category: string
): Promise<Competition[]> {
  const normalizedQuery = query.trim();

  // 1. URL Target InfoLomba (Tetap Ada)
  const infolombaUrl = normalizedQuery
    ? `https://www.infolomba.id/events?sort=Default&title=${encodeURIComponent(normalizedQuery)}+&peserta=Semua+Peserta&lokasi=Semua+Lokasi&kategori=Semua+Kategori`
    : "https://www.infolomba.id/events";

  // 2. URL Target Kalender LuarKampus (Tetap Ada & pakai filter lokal)
  const currentMonth = new Date().getMonth() + 1; 
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const luarkampusUrls = [
    `https://luarkampus.id/events?month=${currentMonth}`,
    `https://luarkampus.id/events?month=${nextMonth}`
  ];

  // 3. URL Target Kompetisi.co.id (Baru Ditambahkan)
  const kompetisiCoIdUrl = "https://kompetisi.co.id";

  // 4. Proses Jalan Bareng (Paralel) untuk 3 Sumber Diatas
  const promises: Promise<Competition[]>[] = [
    // Jalankan InfoLomba
    fetchHtml(infolombaUrl).then((html) => parseInfoLombaCompetitions(html, normalizedQuery)),
    // Jalankan Kompetisi.co.id
    fetchHtml(kompetisiCoIdUrl).then((html) => parseKompetisiCoIdCompetitions(html, normalizedQuery))
  ];

  // Jalankan LuarKampus (Bulan ini & Bulan depan)
  luarkampusUrls.forEach(url => {
    promises.push(fetchHtml(url).then((html) => parseLuarKampusCompetitions(html, normalizedQuery)));
  });

  // Tunggu semua data dari 3 web selesai di-scrape
  const results = await Promise.allSettled(promises);

  const competitions: Competition[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      competitions.push(...result.value);
    }
  }
// 5. JAMINAN BEBAS DOUBLE: Deduplikasi berbasis Title Key
  const uniqueByTitle = new Map<string, Competition>();
  
  competitions.forEach((comp) => {
    const titleKey = comp.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
    
    if (!uniqueByTitle.has(titleKey)) {
      uniqueByTitle.set(titleKey, comp);
    }
  });
  return Array.from(uniqueByTitle.values());
}
// ─────────────────────────────────────────────────────────────────────────────
// Mock data (fallback)
// ─────────────────────────────────────────────────────────────────────────────

const mockCompetitions: Competition[] = [
  {
    id: "c1",
    title: "National Business Plan 2026",
    shortDescription: "Kompetisi rancangan bisnis nasional untuk mahasiswa dan umum.",
    url: "https://infolomba.id/business-plan-2026",
    source: "InfoLomba",
    deadline: "15 Oct 2026",
    category: "Business",
    tags: ["Business Plan", "Startup", "Mahasiswa"],
    isUpcoming: true,
    imageUrl: "https://www.infolomba.id/images/event/poster/default.jpeg"
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// Express Server
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/competitions", async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      const category = (req.query.category as string) || "all";

      let competitions = await fetchCompetitionsFromSources(q, category);

      if (category !== "all") {
        competitions = competitions.filter((c) => c.category === category);
      }

      if (q) {
        const lower = q.toLowerCase();
        competitions = competitions.filter(
          (c) =>
            c.title.toLowerCase().includes(lower) ||
            c.shortDescription.toLowerCase().includes(lower) ||
            c.tags.some((t) => t.toLowerCase().includes(lower))
        );
      }

      res.json(competitions.slice(0, 50));
    } catch (error: any) {
      console.error("Error fetching competitions:", error);
      res.status(500).json({ error: "Failed to fetch competitions." });
    }
  });

  app.get("/api/competitions/batch", async (req, res) => {
    try {
      const idsStr = (req.query.ids as string || "").trim();
      if (!idsStr) return res.json([]);

      const ids = idsStr.split(",").filter(Boolean);
      const allComps = await fetchCompetitionsFromSources("", "all");
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