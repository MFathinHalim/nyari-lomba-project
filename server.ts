import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as puppeteer from '@cloudflare/puppeteer'

// 1. Definisikan tipe Environment Binding sesuai wrangler.toml
type Env = {
  Bindings: {
    MY_BROWSER: puppeteer.BrowserWorker
  }
}

const app = new Hono<Env>()

// 2. Aktifkan Middleware CORS agar bisa diakses oleh Frontend Vite
app.use('/api/*', cors({
  origin: '*', // Sesuaikan dengan domain frontend kamu jika sudah produksi
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
}))

// 3. Endpoint Utama untuk Scraping Puspresnas
app.get('/api/competitions/puspresnas', async (c) => {
  let browser: puppeteer.Browser | null = null

  try {
    // Memastikan binding MY_BROWSER terdeteksi oleh Cloudflare
    if (!c.env.MY_BROWSER) {
      return c.json({ 
        success: false, 
        message: "Browser Rendering binding (MY_BROWSER) tidak ditemukan. Pastikan wrangler.toml sudah benar dan aktif di dashboard." 
      }, 500)
    }

    // Launch headless browser dari serverless infrastructure Cloudflare
    browser = await puppeteer.launch(c.env.MY_BROWSER)
    const page = await browser.newPage()

    // Atur viewport dan User Agent agar tidak dicurigai sebagai bot kasar
    await page.setViewport({ width: 1280, height: 800 })
    
    // Buka website target Puspresnas
    const targetUrl = 'https://pusatprestasinasional.kemdikbud.go.id/'
    await page.goto(targetUrl, { 
      waitUntil: 'networkidle2', // Tunggu sampai traffic jaringan mereda
      timeout: 30000 
    })

    // Jalankan logika evaluasi DOM di dalam halaman browser untuk mengambil data
    const kometisiData = await page.evaluate(() => {
      // Jalankan query selector sesuai dengan struktur HTML website Puspresnas aktual
      // Ini adalah contoh ekstraksi card/list kompetisi (sesuaikan selector class-nya dengan web asli)
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

    // Kembalikan data sukses berformat JSON bersih
    return c.json({
      success: true,
      source: targetUrl,
      scrapedAt: new Date().toISOString(),
      data: kometisiData
    })

  } catch (error: any) {
    console.error("Scraping Error:", error)
    return c.json({ 
      success: false, 
      message: "Gagal mengambil data dari Puspresnas", 
      error: error.message 
    }, 500)
  } finally {
    // Pastikan browser SELALU ditutup agar tidak terjadi memory leak (resource zombie)
    if (browser) {
      await browser.close()
    }
  }
})

// 4. Fallback Endpoint untuk mengecek status API
app.get('/api/health', (c) => {
  return c.json({ status: "OK", message: "Server API berjalan normal di Edge Workers!" })
})

// 5. WAJIB: Export default untuk arsitektur ES Modules Cloudflare Workers
export default app