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
// HELPERS
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
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

async function fetchHtml(url: string): Promise<string> {
  try {
    const response = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 6000 });
    return response.data;
  } catch (error) {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSERS
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

    // Fix OpenPoster Konsep Nyata: Ambil isi dari string fungsi onclick
    let imageUrl = card.find("img").first().attr("src")?.trim() || "";
    const htmlString = card.html() || "";
    const posterMatch = htmlString.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/i);
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
    const htmlString = card.html() || "";
    const posterMatch = htmlString.match(/openPoster\s*\(\s*['"]([^'"]+)['"]/i);
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

// ========================================================
// 1. ENDPOINT LOMBA UMUM (Page 1 s/d Page 4 Berfungsi Lengkap)
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
// 2. ENDPOINT PUSPRESNAS (FIXED & DIJAMIN TEMBUS)
// ========================================================
app.get('/api/competitions/puspresnas', async (c) => {
  let browser: puppeteer.Browser | null = null;
  const query = (c.req.query('q') || "").trim().toLowerCase();
  const categoryFilter = c.req.query('category') || "all";
  
  const jenjangs = ["sma", "smp", "sd"];
  const finalPuspresnasList: any[] = [];

  try {
    if (!c.env.MY_BROWSER) return c.json({ error: "Browser binding tidak ditemukan" });

    browser = await puppeteer.launch(c.env.MY_BROWSER);
    const page = await browser.newPage();
    
    // Set viewport standar laptop
    await page.setViewport({ width: 1280, height: 800 });

    for (const jenjang of jenjangs) {
      try {
        const targetUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/jenjang/${jenjang}`;
        
        // JANGAN pakai networkidle0. Pakai domcontentloaded + manual timeout bawaan Worker biar gak diblokir.
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        
        // Manual delay 3 detik wajib hukumnya biar script hydration internal Kemendikbud kelar gambar kartu lombanya
        await new Promise(r => setTimeout(r, 3000));

        const html = await page.content();
        const $ = cheerio.load(html);

        // SELEKTOR SAKTI: Puspresnas pakai struktur flex grid bawaan layout barunya. 
        // Kita target langsung elemen "a" yang mengarah ke info detail kompetisi di dalam komponen utamanya.
        $("a[href*='/kompetisi/detail/'], .card, [class*='card']").each((_, el) => {
          const element = $(el);
          
          // Cari judul di elemen teks heading manapun yang ada di dalam box komponen
          const title = element.find("h5, h6, .card-title, p strong").first().text().trim();
          if (!title || title.length < 4) return;

          let href = element.attr("href")?.trim() || element.find("a").first().attr("href")?.trim() || "";
          if (!href || href === "#") return;
          
          let detailUrl = href.startsWith("http") ? href : `https://pusatprestasinasional.kemendikdasmen.go.id${href.startsWith("/") ? "" : "/"}${href}`;
          
          let imageUrl = element.find("img").first().attr("src")?.trim() || "";
          if (imageUrl && !imageUrl.startsWith("http")) {
            imageUrl = `https://pusatprestasinasional.kemendikdasmen.go.id/${imageUrl.replace(/^\//, "")}`;
          }

          // Cari elemen tanggal/badge di sekitarnya
          const deadlineText = element.find("[class*='badge'], span:has(i), .text-muted").text().trim() || "Lihat Panduan";
          
          finalPuspresnasList.push({
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
      } catch (e) {
        continue;
      }
    }

    // Bersihkan duplikasi akibat selektor ganda dari gabungan class '.card'
    const uniqueMap = new Map<string, any>();
    finalPuspresnasList.forEach(item => {
      const slug = item.title.toLowerCase().trim().replace(/[\W_]+/g, "-");
      if (!uniqueMap.has(slug)) uniqueMap.set(slug, item);
    });
    
    let filteredPuspresnas = Array.from(uniqueMap.values());

    if (query) filteredPuspresnas = filteredPuspresnas.filter(c => c.title.toLowerCase().includes(query));
    if (categoryFilter !== "all") filteredPuspresnas = filteredPuspresnas.filter(c => c.category === categoryFilter);

    return c.json(filteredPuspresnas);
  } catch (err: any) {
    return c.json({ error: err.message, stack: err.stack });
  } finally {
    if (browser) await browser.close();
  }
})

export default app