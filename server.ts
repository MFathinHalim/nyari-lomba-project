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

// ========================================================
// 1. ENDPOINT PUSPRESNAS (Pake Browser Rendering Cloudflare)
// ========================================================
app.get('/api/competitions/puspresnas', async (c) => {
  let browser: puppeteer.Browser | null = null
  try {
    if (!c.env.MY_BROWSER) {
      return c.json({ success: false, message: "Binding MY_BROWSER tidak aktif." }, 500)
    }

    browser = await puppeteer.launch(c.env.MY_BROWSER)
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    
    const targetUrl = 'https://pusatprestasinasional.kemdikbud.go.id/'
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 })

    const kompetisiData = await page.evaluate(() => {
      const articles = document.querySelectorAll('.card, .post-item, article') 
      const results: any[] = []
      articles.forEach((el) => {
        const titleEl = el.querySelector('h3, .title, .entry-title')
        const linkEl = el.querySelector('a')
        const imgEl = el.querySelector('img')
        const descEl = el.querySelector('p, .description')

        if (titleEl) {
          results.push({
            title: titleEl.textContent?.trim() || '',
            url: linkEl?.getAttribute('href') || '',
            image: imgEl?.getAttribute('src') || '',
            description: descEl?.textContent?.trim() || ''
          })
        }
      })
      return results
    })

    return c.json({ success: true, source: 'puspresnas', data: kompetisiData })
  } catch (error: any) {
    return c.json({ success: false, source: 'puspresnas', error: error.message }, 500)
  } finally {
    if (browser) await browser.close()
  }
})

// ========================================================
// 2. ENDPOINT INFOLOMBA.ID (Pake Fetch + Cheerio Biasa)
// ========================================================
app.get('/api/competitions/infolomba', async (c) => {
  try {
    const targetUrl = 'https://www.infolomba.id/'
    const { data } = await axios.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    })
    
    const $ = cheerio.load(data)
    const results: any[] = []

    // FIX: Menggunakan .each() milik Cheerio agar TypeScript senang
    $('.post, .article, .blog-post').each((_, el) => {
      const title = $(el).find('h2, .post-title').text().trim()
      const url = $(el).find('a').attr('href') || ''
      const image = $(el).find('img').attr('src') || ''
      
      if (title) {
        results.push({ title, url, image, description: '' })
      }
    })

    return c.json({ success: true, source: 'infolomba', data: results })
  } catch (error: any) {
    return c.json({ success: false, source: 'infolomba', error: error.message }, 500)
  }
})

// ========================================================
// 3. ENDPOINT TAMBAHAN LAIN
// ========================================================
app.get('/api/competitions/lainnya', async (c) => {
  return c.json({ success: true, source: 'lainnya', data: [] })
})

app.get('/api/health', (c) => c.json({ status: "OK", server: "Cloudflare Workers Edge" }))

export default app