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

// ========================================================
// 1. RUTE UTAMA / FAST URL (Dipanggil Frontend sebagai fastUrl)
//    Menggabungkan semua website cepat seperti infolomba, dll.
// ========================================================
app.get('/api/competitions', async (c) => {
  const results: any[] = []
  
  // Ambil parameter query pencarian jika ada dari frontend
  const q = c.req.query('q')?.toLowerCase() || ''

  try {
    // ---- SCRAPER INFOLOMBA.ID ----
    const targetUrl = 'https://www.infolomba.id/'
    const { data } = await axios.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000
    })
    
    const $ = cheerio.load(data)

    $('.post, .article, .blog-post').each((index, el) => {
      const title = $(el).find('h2, .post-title').text().trim()
      const url = $(el).find('a').attr('href') || ''
      const image = $(el).find('img').attr('src') || ''
      
      // Bikin ID unik tiruan agar Firebase/Frontend lu gak kebingungan membaca key ID
      const id = `infolomba-${index}-${Buffer.from(title).toString('base64').substring(0, 6)}`

      if (title) {
        const item = {
          id,
          title,
          url,
          image,
          description: 'Ajang kompetisi menarik dari portal Infolomba.id',
          deadline: 'Lihat di Sumber', // Sesuaikan jika scraper lu mengekstrak tanggal asli
          isUpcoming: true,
          category: 'all'
        }

        // Filter sederhana berdasarkan query pencarian dari frontend
        if (!q || title.toLowerCase().includes(q)) {
          results.push(item)
        }
      }
    })

    // ---- TEMPAT UNTUK WEB CEPAT LAINNYA ----
    // Jika ada web kompetisi kedua/ketiga yang pakai cheerio, eksekusi di bawah sini
    // dan langsung results.push() ke dalam array yang sama.

    return c.json(results) // Langsung kembalikan array murni [{}, {}] sesuai ekspektasi frontend
  } catch (error: any) {
    console.error("Error memuat kompetisi standar:", error)
    // Jika gagal, kembalikan array kosong agar frontend tidak crash total
    return c.json([]) 
  }
})

// ========================================================
// 2. RUTE PUSPRESNAS / SLOW URL (Dipanggil Frontend sebagai puspresnasUrl)
//    Khusus menggunakan Browser Rendering Cloudflare Edge
// ========================================================
app.get('/api/competitions/puspresnas', async (c) => {
  let browser: puppeteer.Browser | null = null
  const q = c.req.query('q')?.toLowerCase() || ''

  try {
    if (!c.env.MY_BROWSER) {
      return c.json({ success: false, message: "Binding MY_BROWSER tidak aktif di Cloudflare." }, 500)
    }

    browser = await puppeteer.launch(c.env.MY_BROWSER)
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    
    const targetUrl = 'https://pusatprestasinasional.kemdikbud.go.id/'
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    const scrapedData = await page.evaluate(() => {
      const articles = document.querySelectorAll('.card, .post-item, article') 
      const arr: any[] = []
      articles.forEach((el, index) => {
        const titleEl = el.querySelector('h3, .title, .entry-title')
        const linkEl = el.querySelector('a')
        const imgEl = el.querySelector('img')
        const descEl = el.querySelector('p, .description')

        if (titleEl) {
          const title = titleEl.textContent?.trim() || ''
          arr.push({
            id: `puspresnas-${index}`,
            title,
            url: linkEl?.getAttribute('href') || '',
            image: imgEl?.getAttribute('src') || '',
            description: descEl?.textContent?.trim() || 'Ajang kompetisi resmi skala nasional oleh Puspresnas Kemdikbud.',
            deadline: 'Hubungi Puspresnas',
            isUpcoming: true,
            category: 'all'
          })
        }
      })
      return arr
    })

    // Filter pencarian query untuk data Puspresnas
    const filteredData = q 
      ? scrapedData.filter(item => item.title.toLowerCase().includes(q))
      : scrapedData

    // PERHATIKAN: Frontend lu melakukan: setCompetitions(prev => [...prev, ...puspresnasData])
    // Artinya frontend berekspektasi menerima ARRAY MURNI [{}, {}], BUKAN objek { success: true, data: [] }
    return c.json(filteredData)

  } catch (error: any) {
    console.error("Gagal memuat Puspresnas:", error)
    return c.json([]) // Kembalikan array kosong jika crash agar stream ekor frontend tidak patah
  } finally {
    if (browser) await browser.close()
  }
})

// Health check endpoint
app.get('/api/health', (c) => c.json({ status: "OK", server: "Cloudflare Workers Edge" }))

export default app