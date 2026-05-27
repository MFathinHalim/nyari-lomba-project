import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as cheerio from 'cheerio'
import axios from 'axios'

const app = new Hono()

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS & CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Business: ["business", "entrepreneur", "startup", "marketing", "case", "bisnis", "ekonomi", "manajemen", "akuntansi", "fiksi"],
  Arts: ["design", "art", "creative", "illustration", "visual", "film", "festival", "movie", "video", "sinematografi", "foto", "photography", "poster", "lukis", "gambar", "musik", "lagu", "seni", "olahraga", "o2sn", "fls2n"],
  Science: ["science", "tech", "technology", "research", "innovation", "sains", "matematika", "fisika", "biologi", "kimia", "olimpiade", "riset", "karya tulis", "kti", "osn", "opsi"],
  "E-Sports": ["esports", "gaming", "valorant", "mlbb", "mobile legends", "game", "turnamen", "tournament", "pubg"],
  Writing: ["writing", "cerpen", "essay", "story", "literature", "poetry", "menulis", "esai", "puisi", "sastra", "novel"],
  IT: ["hackathon", "software", "developer", "web", "app", "blockchain", "programming", "coding", "ui/ux", "cyber", "data science", "ai", "cloud"],
};

function guessCategory(raw: string): string {
  const content = raw.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => content.includes(kw))) {
      return category;
    }
  }
  return "IT"; 
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

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8,en;q=0.7",
};

async function fetchHtml(url: string): Promise<string> {
  try {
    const response = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 7000 });
    return response.data;
  } catch (error) {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSERS
// ─────────────────────────────────────────────────────────────────────────────
function parsePuspresnasSma(html: string): any[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: any[] = [];

  // 1. Target langsung kontainer .card bawaan Svelte-nya
  $(".card").each((_, el) => {
    const card = $(el);
    
    // 2. Ambil judul dari tag h2 di dalam card-content
    const title = card.find(".card-content h2").text().trim();
    if (!title) return;

    // Filter biar murni dapet ajang resmi talenta aja
    if (!/osn|opsi|ldi|ldbi|fiksi|nsdc|o2sn|fls2n|olimpiade|debat|talenta/i.test(title)) return;

    // 3. Ambil URL Detail dari tombol "Info Lebih Lanjut"
    let detailUrl = card.find(".links a").attr("href")?.trim() || "";
    if (!detailUrl) {
      // Fallback kalau tombolnya gak ketemu, pakai link apa aja yang ada di card
      detailUrl = card.find("a").attr("href")?.trim() || "https://sma.pusatprestasinasional.kemdikbud.go.id/";
    }

    // 4. Ambil Image/Poster src
    let imageUrl = card.find(".card-image img").attr("src")?.trim() || "";

    // 5. Ekstrak Tanggal Pendaftaran
    // Mengambil teks dari date-item pertama (Pendaftaran: 16 Feb 2026 - 31 Mar 2026 Sudah ditutup)
    const pendaftaranEl = card.find(".dates .date-item").first();
    let deadlineText = "Lihat Portal";
    if (pendaftaranEl.length) {
      const label = pendaftaranEl.find(".label").text().trim(); // "Pendaftaran"
      const value = pendaftaranEl.find(".value").text().trim(); // "16 Feb 2026 - 31 Mar 2026"
      const remaining = pendaftaranEl.find(".remaining").text().trim(); // "Sudah ditutup"
      
      deadlineText = `${value} (${remaining})`;
    }

    // Cek status apakah kompetisi masih akan datang atau sudah lewat
    const isPast = deadlineText.toLowerCase().includes("sudah ditutup");

    competitions.push({
      id: normalizeId(detailUrl, "puspresnas-sma"),
      title,
      shortDescription: card.find(".description").text().trim() || `Ajang Talenta Resmi Tingkat Nasional (OSN/OPSI/LDI).`,
      url: detailUrl,
      source: "Puspresnas SMA",
      deadline: deadlineText,
      category: guessCategory(title),
      tags: ["Puspresnas", "Official", "SMA"],
      isUpcoming: !isPast, // true jika belum ditutup
      imageUrl
    });
  });

  return competitions;
}

function parseInfoLomba(html: string, query: string): any[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: any[] = [];
  const lowerQuery = query.toLowerCase();

  $(".event-container").each((_, el) => {
    const container = $(el);
    const anchor = container.find(".event-title a").first();
    const title = anchor.text().trim();
    if (!title) return;

    let finalUrl = "";
    const onClickAttr = anchor.attr("onclick")?.trim() || "";
    const match = onClickAttr.match(/loadDetailsEvent\s*\(\s*(\d+)\s*,\s*['"]([^'"]+)['"]/);
    if (match && match[1] && match[2]) {
      finalUrl = `https://www.infolomba.id/info-${match[2]}-${match[1]}`;
    } else {
      let href = anchor.attr("href")?.trim() || "";
      if (href && href !== "#") finalUrl = href.startsWith("http") ? href : `https://www.infolomba.id${href}`;
    }

    let imageUrl = container.find(".img-container img").first().attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) imageUrl = `https://www.infolomba.id/${imageUrl}`;
    const tanggalText = container.find(".tanggal").text().trim();
    
    if (!lowerQuery || title.toLowerCase().includes(lowerQuery)) {
      competitions.push({
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
    }
  });
  return competitions;
}

function parseLuarKampus(html: string): any[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: any[] = [];

  $("a[href*='/events/']").each((_, el) => {
    const card = $(el);
    const title = card.find("p.font-bold").text().trim();
    if (!title) return;

    let href = card.attr("href")?.trim() || "";
    const detailUrl = href.startsWith("http") ? href : `https://luarkampus.id${href}`;
    let rawImg = card.find("img").first().attr("src")?.trim() || "";
    let imageUrl = rawImg ? (rawImg.startsWith("http") ? rawImg : `https://luarkampus.id/${rawImg.replace(/^\//, "")}`) : "";
    const deadline = card.find("span.text-red-600 b").text().trim() || "TBA";

    competitions.push({
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
    });
  });
  return competitions;
}

function parseKompetisiCoId(html: string): any[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: any[] = [];

  $(".group.bg-white").each((_, el) => {
    const card = $(el);
    const title = card.find("h3").text().trim();
    if (!title) return;

    let href = card.find("a[href*='kompetisi?id=']").first().attr("href")?.trim() || "";
    if (!href) return;
    const detailUrl = `https://kompetisi.co.id/${href}`;

    let imageUrl = card.find("img").first().attr("src")?.trim() || "";
    const cardHtml = card.html() || "";
    const posterMatch = cardHtml.match(/openPoster\s*\(\s*['"]\s*([^'"]+?)\s*['"]\s*\)/i);
    if (posterMatch && posterMatch[1]) {
      imageUrl = posterMatch[1];
    }

    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `https://kompetisi.co.id/${imageUrl.replace(/^\//, "")}`;
    }

    competitions.push({
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
    });
  });
  return competitions;
}

function parseKompetisiOnline(html: string, query: string): any[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const competitions: any[] = [];
  const lowerQuery = query.toLowerCase();

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
    
    const detailUrl = href.startsWith("http") ? href : `https://kompetisionline.com/${href.replace(/^\//, "")}`;

    let imageUrl = card.find("img").first().attr("src")?.trim() || "";
    const cardHtml = card.html() || "";
    const posterMatch = cardHtml.match(/openPoster\s*\(\s*['"]\s*([^'"]+?)\s*['"]\s*\)/i);
    if (posterMatch && posterMatch[1]) {
      imageUrl = posterMatch[1];
    }

    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `https://kompetisionline.com/${imageUrl.replace(/^\//, "")}`;
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

    if (!lowerQuery || title.toLowerCase().includes(lowerQuery) || tags.some(t => t.toLowerCase().includes(lowerQuery))) {
      competitions.push({
        id: normalizeId(detailUrl, "kompetisionline"),
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
    }
  });
  return competitions;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/competitions', async (c) => {
  const query = (c.req.query('q') || "").trim();
  const categoryFilter = c.req.query('category') || "all";

  const encodedQuery = encodeURIComponent(query);
  const infolombaUrl = query ? `https://www.infolomba.id/events?sort=Default&title=${encodedQuery}` : "https://www.infolomba.id/events";
  const currentMonth = new Date().getMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;

  try {
    const targets = [
      fetchHtml("https://sma.pusatprestasinasional.kemdikbud.go.id/").then(h => parsePuspresnasSma(h)), // << DATA RESMI KEDINASAN (OSN, OPSI, LDI)
      fetchHtml(infolombaUrl).then(h => parseInfoLomba(h, query)),
      fetchHtml("https://kompetisi.co.id/?page=1").then(h => parseKompetisiCoId(h)),
      fetchHtml("https://kompetisi.co.id/?page=2").then(h => parseKompetisiCoId(h)),
      fetchHtml("https://kompetisi.co.id/?page=3").then(h => parseKompetisiCoId(h)),
      fetchHtml("https://kompetisi.co.id/?page=4").then(h => parseKompetisiCoId(h)),
      fetchHtml("https://kompetisionline.com/?page=1").then(h => parseKompetisiOnline(h, query)),
      fetchHtml("https://kompetisionline.com/?page=2").then(h => parseKompetisiOnline(h, query)),
      fetchHtml(`https://luarkampus.id/events?month=${currentMonth}`).then(h => parseLuarKampus(h)),
      fetchHtml(`https://luarkampus.id/events?month=${nextMonth}`).then(h => parseLuarKampus(h))
    ];

    const responses = await Promise.allSettled(targets);
    const rawCompetitions: any[] = [];

    responses.forEach((res, idx) => {
      if (res.status === "fulfilled") {
        if (idx === 0 || idx === 1) {
          // Puspresnas SMA dan InfoLomba dimasukkan langsung karena sudah difilter di level parser
          rawCompetitions.push(...res.value);
        } else {
          const items = res.value;
          if (!query) {
            rawCompetitions.push(...items);
          } else {
            const lowerQ = query.toLowerCase();
            const filtered = items.filter((comp: any) => comp.title.toLowerCase().includes(lowerQ));
            rawCompetitions.push(...filtered);
          }
        }
      }
    });

    const uniqueMap = new Map<string, any>();
    rawCompetitions.forEach(comp => {
      const titleKey = comp.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
      if (!uniqueMap.has(titleKey)) uniqueMap.set(titleKey, comp);
    });

    let filteredResults = Array.from(uniqueMap.values());

    // Filter tambahan berdasarkan Query parameter jika user melakukan pencarian global
    if (query) {
      const lowerQ = query.toLowerCase();
      filteredResults = filteredResults.filter(comp => comp.title.toLowerCase().includes(lowerQ));
    }

    // Filter berdasarkan Kategori
    if (categoryFilter !== "all") {
      filteredResults = filteredResults.filter(comp => comp.category === categoryFilter);
    }

    return c.json(filteredResults.slice(0, 180));
  } catch (err) {
    return c.json([]);
  }
})

app.get("/", (c) => c.text("Nantangin Hybrid API (with Puspresnas SMA) is running perfectly! 🚀"));

export default app