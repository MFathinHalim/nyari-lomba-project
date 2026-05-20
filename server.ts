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
// InfoLomba Real Scraper (Mengambil Link Asli Sesuai Web Target)
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

    // 1. Ambil Judul
    const anchor = container.find(".event-title a").first();
    const title = anchor.text().trim();
    if (!title) return;

    // 2. FIXED REGEX: Ambil ID Angka DAN Slug Teks dari fungsi onclick
    const onClickAttr = anchor.attr("onclick")?.trim() || "";
    let finalUrl = "";

    // Regex ini menangkap dua variabel: loadDetailsEvent(ID_ANGKA, 'SLUG_TEKS')
    const match = onClickAttr.match(/loadDetailsEvent\s*\(\s*(\d+)\s*,\s*['"]([^'"]+)['"]/);
    
    if (match && match[1] && match[2]) {
      const eventId = match[1];   // Contoh: 1788
      const eventSlug = match[2]; // Contoh: swift-debate-2026
      
      // InfoLomba menggunakan format: /info-slug-id
      finalUrl = `${baseUrl}/info-${eventSlug}-${eventId}`;
    } else {
      // Fallback jika formatnya ternyata link biasa (href)
      let href = anchor.attr("href")?.trim() || "";
      if (href && !href.startsWith("javascript:") && href !== "#") {
        finalUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
      }
    }

    // Jika gagal mendapatkan URL valid, skip data ini
    if (!finalUrl) return;

    const id = normalizeId(finalUrl, "infolomba");

    // 3. Ekstrak Gambar Poster
    const imgEl = container.find(".img-container img").first();
    let imageUrl = imgEl.attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = imageUrl.startsWith("/") ? `${baseUrl}${imageUrl}` : `${baseUrl}/${imageUrl}`;
    }

    // 4. Ekstrak Meta Data Kartu
    const targetText = container.find(".target").text().trim(); 
    const biayaText = container.find(".biaya").text().trim();   
    const lokasiText = container.find(".lokasi").text().trim(); 
    const tanggalText = container.find(".tanggal").text().trim(); 
    const penyelenggara = container.find(".penyelenggara div span").not(".subtitle").text().trim();

    const description = `Penyelenggara: ${penyelenggara || "TBA"}. Target Peserta: ${targetText}. Biaya: ${biayaText}. Lokasi: ${lokasiText}.`;

    // 5. Batas Waktu (Deadline)
    let deadline = "TBA";
    if (tanggalText) {
      const dateParts = tanggalText.split("-");
      deadline = dateParts.length > 1 ? dateParts[1].trim() : tanggalText;
    }

    // 6. Ekstrak Tags
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

    // 7. Deteksi Status Kedaluwarsa
    const isPastEvent = container.hasClass("event-past");

    const competition = normalizeCompetition({
      id,
      title,
      shortDescription: description,
      url: finalUrl, // Sekarang URL terisi dengan rapi, contoh: https://www.infolomba.id/info-swift-debate-2026-1788
      source: "InfoLomba",
      deadline,
      category: guessCategory(`${title} ${description}`),
      tags,
      isUpcoming: !isPastEvent,
      imageUrl, 
    });

    // 8. Filter Pencarian Lokal
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
// Orchestrator (Penyaring Duplikasi Berbasis Judul)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchCompetitionsFromSources(
  query: string,
  _category: string
): Promise<Competition[]> {
  const normalizedQuery = query.trim();

  const infolombaUrl = normalizedQuery
    ? `https://www.infolomba.id/events?sort=Default&title=${encodeURIComponent(normalizedQuery)}+&peserta=Semua+Peserta&lokasi=Semua+Lokasi&kategori=Semua+Kategori`
    : "https://www.infolomba.id/events";

  const results = await Promise.allSettled([
    fetchDevpostCompetitions(normalizedQuery),
    fetchHtml(infolombaUrl).then((html) => parseInfoLombaCompetitions(html, normalizedQuery)),
  ]);

  const competitions: Competition[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      competitions.push(...result.value);
    }
  }

  if (competitions.length === 0) {
    return mockCompetitions;
  }

  // JAMINAN 100% BEBAS DOUBLE: Filter berdasarkan judul murni (Tanpa peduli variasi angka di akhir URL)
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