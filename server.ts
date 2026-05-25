import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as puppeteer from '@cloudflare/puppeteer'
import * as cheerio from 'cheerio'
import axios from 'axios'

type Env = {
  Bindings: {
    MY_BROWSER: puppeteer.BrowserWorker
  }
}

const app = new Hono<Env>()

app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS & CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────
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
// PARSERS (100% SAMA PERSIS DENGAN KODE LAMA LU + FIX POSTER)
// ─────────────────────────────────────────────────────────────────────────────
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

    // ELEMEN POSTER KHUSUS (OPENPOSTER) FIXED DENGAN REGEX KUAT
    let imageUrl = card.find("img").first().attr("src")?.trim() || "";
    
    // Scan seluruh HTML di card ini untuk mencari fungsi openPoster bawaan lu
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
// SCRIPT PARSER KHUSUS PUSPRESNAS LAYOUT BARU (UNIVERSAL SELECTOR)
// ─────────────────────────────────────────────────────────────────────────────
function parsePuspresnasHtml(html: string, jenjang: string): any[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const list: any[] = [];

  // Puspresnas memakai SSR Hydration, kita target element card bootstrap atau anchor detailnya langsung
  $("a[href*='/kompetisi/detail/'], .card, [class*='card'], .grid > div").each((_, el) => {
    const node = $(el);
    
    // Ambil title dari teks berbobot tebal paling pertama di dalam block kontainer komponen
    const title = node.find("h5, h6, .card-title, strong, p.font-bold").first().text().trim();
    if (!title || title.length < 4 || title.includes("Kemendikbud")) return;

    let href = node.attr("href")?.trim() || node.find("a").first().attr("href")?.trim() || "";
    if (!href || href === "#") return;
    
    const detailUrl = href.startsWith("http") ? href : `https://pusatprestasinasional.kemendikdasmen.go.id${href.startsWith("/") ? "" : "/"}${href}`;
    
    let imageUrl = node.find("img").first().attr("src")?.trim() || "";
    if (imageUrl && !imageUrl.startsWith("http")) {
      imageUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/${imageUrl.replace(/^\//, "")}`;
    }

    const deadlineText = node.find("[class*='badge'], span:has(i), .text-gray-500").text().trim() || "Lihat Panduan";

    list.push({
      id: normalizeId(detailUrl, `puspresnas-${jenjang}`),
      title,
      shortDescription: `Kompetisi Resmi Puspresnas Nasional Jenjang ${jenjang.toUpperCase()}.`,
      url: detailUrl,
      source: "Puspresnas",
      deadline: deadlineText.replace(/[\n\t]/g, " ").replace(/\s+/g, " ").trim(),
      category: guessCategory(title),
      tags: ["Puspresnas", jenjang.toUpperCase()],
      isUpcoming: true,
      imageUrl
    });
  });

  return list;
}

// ========================================================
// 1. ENDPOINT LOMBA UMUM (Banyak Halaman, Poster Aman)
// ========================================================
app.get('/api/competitions', async (c) => {
  const query = (c.req.query('q') || "").trim();
  const categoryFilter = c.req.query('category') || "all";

  const encodedQuery = encodeURIComponent(query);
  const infolombaUrl = query ? `https://www.infolomba.id/events?sort=Default&title=${encodedQuery}` : "https://www.infolomba.id/events";
  const currentMonth = new Date().getMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;

  try {
    const targets = [
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
        if (idx === 0) {
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
    if (categoryFilter !== "all") {
      filteredResults = filteredResults.filter(comp => comp.category === categoryFilter);
    }

    return c.json(filteredResults.slice(0, 150));
  } catch (err) {
    return c.json([]);
  }
})

// ========================================================
// 2. ENDPOINT PUSPRESNAS (ANTI BLOKIR + LOGGER DIAGNOSTIK)
// ========================================================
app.get('/api/competitions/puspresnas', async (c) => {
  let browser: puppeteer.Browser | null = null;
  const query = (c.req.query('q') || "").trim().toLowerCase();
  const categoryFilter = c.req.query('category') || "all";
  
  const jenjangs = ["sma", "smp", "sd"];
  const finalPuspresnasList: any[] = [];
  const logs: string[] = []; // Wadah penanda / tracer

  // STRATEGI UTAMA: Coba jalankan Browser Renderer bawaan Cloudflare Worker
  if (c.env.MY_BROWSER) {
    try {
      logs.push("Mencoba inisialisasi Cloudflare Headless Browser...");
      browser = await puppeteer.launch(c.env.MY_BROWSER);
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

      for (const jenjang of jenjangs) {
        try {
          const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`;
          logs.push(`Browser membuka URL jenjang ${jenjang}...`);
          
          await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
          await new Promise(r => setTimeout(r, 2500)); // Tunggu hidrasi JS DOM kelar

          const html = await page.content();
          const parsedItems = parsePuspresnasHtml(html, jenjang);
          logs.push(`Jenjang ${jenjang} via Browser menghasilkan: ${parsedItems.length} item.`);
          
          finalPuspresnasList.push(...parsedItems);
        } catch (innerErr: any) {
          logs.push(`Gagal memuat jenjang ${jenjang} di browser: ${innerErr.message}`);
        }
      }
    } catch (browserErr: any) {
      logs.push(`Browser global bermasalah: ${browserErr.message}. Beralih ke Taktik API Fallback...`);
    } finally {
      if (browser) await browser.close();
    }
  } else {
    logs.push("Binding MY_BROWSER tidak ditemukan di Wrangler.toml. Menjalankan Taktik API Fallback langsung!");
  }

  // STRATEGI CADANGAN (FALLBACK): Jika browser diblokir Cloudflare/Timeout, tembak HTML langsung
  if (finalPuspresnasList.length === 0) {
    logs.push("Menjalankan Taktik API Fallback (Direct Axios Scraper)...");
    for (const jenjang of jenjangs) {
      try {
        const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`;
        const html = await fetchHtml(targetUrl);
        const parsedItems = parsePuspresnasHtml(html, jenjang);
        logs.push(`Fallback jenjang ${jenjang} menghasilkan: ${parsedItems.length} item.`);
        finalPuspresnasList.push(...parsedItems);
      } catch (fallbackErr: any) {
        logs.push(`Fallback untuk jenjang ${jenjang} juga gagal: ${fallbackErr.message}`);
      }
    }
  }

  // Deduplikasi Item Hasil Gabungan
  const uniqueMap = new Map<string, any>();
  finalPuspresnasList.forEach(item => {
    const slug = item.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
    if (!uniqueMap.has(slug)) uniqueMap.set(slug, item);
  });
  
  let filteredPuspresnas = Array.from(uniqueMap.values());

  if (query) filteredPuspresnas = filteredPuspresnas.filter(c => c.title.toLowerCase().includes(query));
  if (categoryFilter !== "all") filteredPuspresnas = filteredPuspresnas.filter(c => c.category === categoryFilter);

  // Jika hasilnya masih kosong, kita return log penandanya biar lu tau persis rusaknya di mana!
  if (filteredPuspresnas.length === 0) {
    return c.json({
      success: false,
      message: "Data Puspresnas kosong total. Silakan cek tracer log di bawah ini untuk melihat masalah sistem.",
      tracer_logs: logs
    });
  }

  return c.json(filteredPuspresnas);
})

export default app