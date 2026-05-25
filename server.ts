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
// HELPERS & DICTIONARY
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
// 1. ENDPOINT LOMBA LIVE (InfoLomba, LuarKampus, KompetisiCoId, KompetisiOnline)
// ========================================================
app.get('/api/competitions', async (c) => {
  const query = (c.req.query('q') || "").trim().toLowerCase();
  const categoryFilter = c.req.query('category') || "all";
  const rawCompetitions: any[] = []

  const currentMonth = new Date().getMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;

  const encodedQuery = encodeURIComponent(query);
  const infolombaUrl = query
    ? `https://www.infolomba.id/events?sort=Default&title=${encodedQuery}`
    : "https://www.infolomba.id/events";

  try {
    const fetchPromises = [
      // A. InfoLomba Scraper
      axios.get(infolombaUrl, { headers: DEFAULT_HEADERS, timeout: 7000 }).then(res => {
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
      }).catch(() => console.error("InfoLomba Error")),

      // B. LuarKampus Scraper
      axios.get(`https://luarkampus.id/events?month=${currentMonth}`, { headers: DEFAULT_HEADERS, timeout: 7000 }).then(res => {
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

      // C. Kompetisi.co.id Scraper (Struktur Tailwind Card)
      axios.get("https://kompetisi.co.id/?page=1", { headers: DEFAULT_HEADERS, timeout: 7000 }).then(res => {
        const $ = cheerio.load(res.data)
        $(".group.bg-white").each((_, el) => {
          const card = $(el);
          const title = card.find("h3").text().trim();
          if (!title) return;

          let href = card.find("a[href*='competition'], a[href*='id=']").first().attr("href")?.trim() || "";
          if (!href) return;
          const detailUrl = href.startsWith("http") ? href : `https://kompetisi.co.id/${href.replace(/^\//, "")}`;

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
      }).catch(() => console.error("KompetisiCoId Error")),

      // D. KompetisiOnline.com Scraper (KEMBALI DISEDIAKAN)
      axios.get("https://kompetisionline.com/?page=1", { headers: DEFAULT_HEADERS, timeout: 7000 }).then(res => {
        const $ = cheerio.load(res.data)
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

          const tags: string[] = [];
          card.find("span").each((_, badgeEl) => {
            const tagText = $(badgeEl).text().trim();
            if (tagText && tagText.length < 20 && !/2026|Penyisihan|Final/i.test(tagText)) tags.push(tagText);
          });

          rawCompetitions.push({
            id: normalizeId(detailUrl, "kompetisionline"),
            title,
            shortDescription: `Info lomba terupdate via KompetisiOnline.com.`,
            url: detailUrl,
            source: "KompetisiOnline",
            deadline: "Lihat di Web",
            category: guessCategory(`${title} ${tags.join(" ")}`),
            tags: tags.length > 0 ? tags : ["KompetisiOnline"],
            isUpcoming: true,
            imageUrl,
          });
        });
      }).catch(() => console.error("KompetisiOnline Error"))
    ]

    await Promise.allSettled(fetchPromises)

    const uniqueMap = new Map<string, any>();
    rawCompetitions.forEach(comp => {
      const titleKey = comp.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
      if (!uniqueMap.has(titleKey)) uniqueMap.set(titleKey, comp);
    });

    let filteredResults = Array.from(uniqueMap.values());
    if (query) filteredResults = filteredResults.filter(comp => comp.title.toLowerCase().includes(query));
    if (categoryFilter !== "all") filteredResults = filteredResults.filter(comp => comp.category === categoryFilter);

    return c.json(filteredResults.slice(0, 100))
  } catch (err) {
    return c.json([])
  }
})

// ========================================================
// 2. ENDPOINT PUSPRESNAS (SAFE PARALLEL - BEBAS TIMEOUT)
// ========================================================
app.get('/api/competitions/puspresnas', async (c) => {
  let browser: puppeteer.Browser | null = null
  const query = (c.req.query('q') || "").trim().toLowerCase();
  const categoryFilter = c.req.query('category') || "all";
  
  // Ambil Jenjang populer (SMA & SMP) sekaligus secara paralel untuk menghemat limit CPU Edge Workers
  const jenjangs = ["sma", "smp"]
  const finalPuspresnasList: any[] = []

  try {
    if (!c.env.MY_BROWSER) return c.json([])

    browser = await puppeteer.launch(c.env.MY_BROWSER)
    const page = await browser.newPage()
    await page.setViewport({ width: 1024, height: 768 })

    for (const jenjang of jenjangs) {
      try {
        const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12000 })
        await new Promise(r => setTimeout(r, 1500)) // Jeda render hidrasi client-side js

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
        continue;
      }
    }

    let filteredPuspresnas = finalPuspresnasList;
    if (query) filteredPuspresnas = filteredPuspresnas.filter(c => c.title.toLowerCase().includes(query))
    if (categoryFilter !== "all") filteredPuspresnas = filteredPuspresnas.filter(c => c.category === categoryFilter)

    return c.json(filteredPuspresnas)
  } catch (err) {
    return c.json([])
  } finally {
    if (browser) await browser.close()
  }
})

export default app