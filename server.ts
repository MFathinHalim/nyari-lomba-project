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

// Aktifkan CORS biar Frontend Vite lu bisa akses tanpa diblokir
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS & NORMALISASI (Sesuai Server Lama Lu)
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
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
};

// ========================================================
// 1. ENDPOINT KILAT (InfoLomba, LuarKampus, KompetisiCoId)
// ========================================================
app.get('/api/competitions', async (c) => {
  const query = (c.req.query('q') || "").trim().toLowerCase();
  const categoryFilter = c.req.query('category') || "all";
  const rawCompetitions: any[] = []

  // Ambil data bulan sekarang & bulan depan untuk LuarKampus
  const currentMonth = new Date().getMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;

  const encodedQuery = encodeURIComponent(query);
  const infolombaUrl = query
    ? `https://www.infolomba.id/events?sort=Default&title=${encodedQuery}`
    : "https://www.infolomba.id/events";

  try {
    // Jalankan Request Scraper secara Paralel demi menghemat Waktu Eksekusi Edge Worker
    const fetchPromises = [
      // A. InfoLomba Scraper
      axios.get(infolombaUrl, { headers: DEFAULT_HEADERS, timeout: 8000 }).then(res => {
        const $ = cheerio.load(res.data)
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
          
          rawCompetitions.push({
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
        });
      }).catch(() => console.error("InfoLomba Timeout/Error")),

      // B. LuarKampus Scraper (Bulan Ini)
      axios.get(`https://luarkampus.id/events?month=${currentMonth}`, { headers: DEFAULT_HEADERS, timeout: 8000 }).then(res => {
        const $ = cheerio.load(res.data)
        $("a[href*='/events/']").each((_, el) => {
          const card = $(el);
          const title = card.find("p.font-bold").text().trim();
          if (!title) return;

          let href = card.attr("href")?.trim() || "";
          const detailUrl = href.startsWith("http") ? href : `https://luarkampus.id${href}`;
          let rawImg = card.find("img").first().attr("src")?.trim() || "";
          let imageUrl = rawImg ? (rawImg.startsWith("http") ? rawImg : `https://luarkampus.id/${rawImg.replace(/^\//, "")}`) : "";
          const deadline = card.find("span.text-red-600 b").text().trim() || "TBA";

          rawCompetitions.push({
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
      }).catch(() => console.error("LuarKampus Error")),

      // C. Kompetisi.co.id Scraper (Page 1)
      axios.get("https://kompetisi.co.id/?page=1", { headers: DEFAULT_HEADERS, timeout: 8000 }).then(res => {
        const $ = cheerio.load(res.data)
        $(".group.bg-white").each((_, el) => {
          const card = $(el);
          const title = card.find("h3").text().trim();
          if (!title) return;

          let href = card.find("a[href*='kompetisi?id=']").first().attr("href")?.trim() || "";
          if (!href) return;
          const detailUrl = `https://kompetisi.co.id/${href}`;

          let imageUrl = card.find("img").first().attr("src")?.trim() || "";
          if (imageUrl && !imageUrl.startsWith("http")) imageUrl = `https://kompetisi.co.id/${imageUrl.replace(/^\//, "")}`;

          rawCompetitions.push({
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
      }).catch(() => console.error("KompetisiCoId Error"))
    ]

    await Promise.allSettled(fetchPromises)

    // Filter duplikasi data berdasarkan judul unik
    const uniqueMap = new Map<string, any>();
    rawCompetitions.forEach(comp => {
      const titleKey = comp.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
      if (!uniqueMap.has(titleKey)) uniqueMap.set(titleKey, comp);
    });

    let filteredResults = Array.from(uniqueMap.values());

    // Filter kata kunci pencarian internal memori jika query diketik di input frontend
    if (query) {
      filteredResults = filteredResults.filter(comp => comp.title.toLowerCase().includes(query));
    }

    // Filter kategori lomba
    if (categoryFilter !== "all") {
      filteredResults = filteredResults.filter(comp => comp.category === categoryFilter);
    }

    return c.json(filteredResults.slice(0, 100))

  } catch (err) {
    return c.json([])
  }
})

// ========================================================
// 2. ENDPOINT PUSPRESNAS (Ganti Playwright ke Browser Rendering Worker)
// ========================================================
app.get('/api/competitions/puspresnas', async (c) => {
  let browser: puppeteer.Browser | null = null
  const query = (c.req.query('q') || "").trim().toLowerCase();
  const categoryFilter = c.req.query('category') || "all";
  const finalPuspresnasList: any[] = []

  const jenjangs = ["sd", "smp", "sma"]

  try {
    if (!c.env.MY_BROWSER) {
      return c.json([]) // Kembalikan array kosong agar stream frontend tidak meledak
    }

    browser = await puppeteer.launch(c.env.MY_BROWSER)
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 720 })

    // Loop jenjang manual karena Cloudflare Worker tidak punya state RAM startup persistensial (Background Warmup Serverless tidak bisa ngetes cache startup)
    for (const jenjang of jenjangs) {
      try {
        const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
        
        // Jeda rendering script hidrasi DOM internal web kemendikbud
        await new Promise(r => setTimeout(r, 2500))

        const html = await page.content()
        const $ = cheerio.load(html)

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
          
          finalPuspresnasList.push({
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
          })
        })
      } catch (e) {
        console.error(`Gagal parsing jenjang ${jenjang}`);
        continue;
      }
    }

    // Eksekusi filter pencarian akhir
    let filteredPuspresnas = finalPuspresnasList;
    if (query) {
      filteredPuspresnas = filteredPuspresnas.filter(c => c.title.toLowerCase().includes(query))
    }
    if (categoryFilter !== "all") {
      filteredPuspresnas = filteredPuspresnas.filter(c => c.category === categoryFilter)
    }

    return c.json(filteredPuspresnas)

  } catch (err) {
    console.error("Gagal total memuat Puspresnas:", err)
    return c.json([])
  } finally {
    if (browser) await browser.close()
  }
})

// Fallback Health status check
app.get('/api/health', (c) => c.json({ status: "OK" }))

export default app