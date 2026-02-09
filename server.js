const express = require('express')
const path = require('path')
const fetch = require('node-fetch')
const https = require('https')
const puppeteer = require('puppeteer')

// HTTPS agent that ignores SSL certificate errors
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
})

const app = express()

// Browser instance for Puppeteer (reused across requests)
let browserInstance = null

async function getBrowser() {
  // Check if existing browser is still connected
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance
  }

  // Close old instance if disconnected
  if (browserInstance) {
    try { await browserInstance.close() } catch (_) {}
    browserInstance = null
  }

  console.log('[PUPPETEER] Launching new browser...')
  browserInstance = await puppeteer.launch({
    headless: 'new', // Use new headless mode
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list'
    ]
  })
  console.log('[PUPPETEER] Browser launched successfully')
  return browserInstance
}

// Cleanup browser on exit
process.on('exit', async () => {
  if (browserInstance) {
    try { await browserInstance.close() } catch (_) {}
  }
})
process.on('SIGINT', async () => {
  if (browserInstance) {
    try { await browserInstance.close() } catch (_) {}
  }
  process.exit()
})
const PORT = process.env.PORT || 3000

app.use(express.json({ limit: '50mb' }))
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.set('Pragma', 'no-cache')
    res.set('Expires', '0')
  }
}))

function normalizeUrl(input) {
  let url = (input || '').trim()
  if (!url) return null
  
  // Check if original had trailing slash
  const hadTrailingSlash = url.endsWith('/')
  
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url
  }
  try {
    let normalized = new URL(url).toString()
    // Remove trailing slash unless it was in the original input or has a path
    if (!hadTrailingSlash && normalized.endsWith('/') && new URL(normalized).pathname === '/') {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  } catch (_) {
    return null
  }
}

function stripUrl(url) {
  // Remove protocol and www to get base domain
  let stripped = url.replace(/^https?:\/\/(www\.)?/i, '').trim()
  // Remove trailing slash if present
  if (stripped.endsWith('/')) {
    stripped = stripped.slice(0, -1)
  }
  return stripped
}

// Extract the root domain (e.g., "omair.com" from "https://www.sub.omair.com/page/path?query=1")
function getRootDomain(urlString) {
  try {
    let url = urlString
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url
    }
    const parsed = new URL(url)
    let hostname = parsed.hostname.toLowerCase()

    // Remove www prefix
    hostname = hostname.replace(/^www\./i, '')

    // Handle common TLDs with multiple parts (co.uk, com.au, etc.)
    const multiPartTLDs = [
      'co.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'com.mx', 'co.jp',
      'co.kr', 'co.in', 'com.sg', 'com.hk', 'com.tw', 'co.id', 'com.ph',
      'com.my', 'com.vn', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.ec',
      'org.uk', 'org.au', 'net.au', 'gov.uk', 'ac.uk', 'edu.au'
    ]

    const parts = hostname.split('.')

    // Check if ends with a multi-part TLD
    for (const tld of multiPartTLDs) {
      if (hostname.endsWith('.' + tld)) {
        // Get domain + multi-part TLD (e.g., "example.co.uk")
        const tldParts = tld.split('.').length
        if (parts.length > tldParts) {
          return parts.slice(-(tldParts + 1)).join('.')
        }
        return hostname
      }
    }

    // Standard TLD - get last two parts (e.g., "example.com")
    if (parts.length >= 2) {
      return parts.slice(-2).join('.')
    }

    return hostname
  } catch (_) {
    // Fallback: try to extract domain from string
    const match = urlString.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/i)
    if (match) {
      const parts = match[1].toLowerCase().split('.')
      if (parts.length >= 2) {
        return parts.slice(-2).join('.')
      }
      return match[1].toLowerCase()
    }
    return urlString.toLowerCase()
  }
}

function generateVariations(baseUrl) {
  // Strip to base domain
  const base = stripUrl(baseUrl)
  
  // Generate all 4 variations in priority order
  // Most common first: https, then https+www, then http, then http+www
  const variations = [
    'https://' + base,           // 1. https://example.com
    'https://www.' + base,       // 2. https://www.example.com
    'http://' + base,            // 3. http://example.com
    'http://www.' + base         // 4. http://www.example.com
  ]
  
  return variations
}

function getHostname(u) {
  try { return new URL(u).hostname } catch { return '' }
}

// Domains that indicate a site is dead, seized, parked, or for sale
const DEAD_DOMAINS = [
  // Domain parking & for sale
  'forsale.godaddy.com', 'godaddy.com', 'sedoparking.com', 'parkingcrew.net',
  'hugedomains.com', 'afternic.com', 'dan.com', 'sedo.com', 'buydomains.com',
  'namecheap.com', 'domainmarket.com', 'undeveloped.com', 'brandpa.com',
  'squadhelp.com', 'domainnamesales.com', 'uniregistry.com', 'parked.com',
  'above.com', 'bodis.com', 'domainlore.co.uk', 'snapnames.com', 'pool.com',
  'namejet.com', 'dropcatch.com', 'porkbun.com',
  // Seized / Law enforcement / Legal takedowns
  'alliance4creativity.com', 'usdoj.gov', 'ice.gov', 'fbi.gov', 'europol.europa.eu',
  'ncmec.org', 'mpaa.org', 'riaa.com', 'lumendatabase.org', 'chillingeffects.org',
  // ISP / Registrar blocks
  'opendns.com', 'malwaredomainlist.com', 'spamhaus.org',
  // Domain expired / suspended
  'suspendedsitepreview.com', 'suspended.page', 'domainexpired.com',
  // Known redirect sinks
  'searchmagnified.com', 'domainnotfound.com', 'websitenotfound.com'
]

const DEAD_URL_PATTERNS = [
  /forsale\./i, /parked\./i, /parking\./i, /domain.*sale/i, /buy.*domain/i,
  /seized/i, /suspended/i, /expired.*domain/i, /domain.*expired/i,
  /this.*domain.*for.*sale/i, /alliance4creativity/i, /antipiracy/i,
  /domain.*available/i, /register.*this.*domain/i, /premium.*domain/i,
  /usdoj\.gov/i, /fbi\.gov/i, /ice\.gov/i, /europol\.europa/i
]

// Check if a URL points to a dead/seized/parked/sale domain
function isDeadDomain(urlString) {
  if (!urlString) return null
  const hostname = getHostname(urlString).toLowerCase()
  const fullUrl = urlString.toLowerCase()

  for (const dead of DEAD_DOMAINS) {
    if (hostname === dead || hostname.endsWith('.' + dead) || fullUrl.includes(dead)) {
      return `Dead site (${dead})`
    }
  }
  for (const pattern of DEAD_URL_PATTERNS) {
    if (pattern.test(fullUrl)) {
      return 'Dead site (seized/parked/expired)'
    }
  }
  return null
}

function classifyStatus(resp, bodySnippet, url) {
  const status = resp.status
  const headers = Object.fromEntries([...resp.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]))
  const serverHeader = headers['server'] || ''
  const hasCfHeaders = Object.keys(headers).some(k => k.startsWith('cf-')) || /cloudflare/i.test(serverHeader)
  
  // Content-based detection patterns
  const patterns = {
    cloudflare: [
      /Just a moment\.\.\./i,
      /Attention Required! \| Cloudflare/i,
      /checking your browser/i,
      /cdn-cgi\//i
    ],
    pageNotFound: [
      /Page Not Found/i,
      /404 Not Found/i,
      /The page you are looking for/i,
      /Welcome to nginx!/i,
      /Apache.*Test Page/i,
      /Default Web Site Page/i,
      /It works!/i
    ]
  }

  // Check for Cloudflare
  const indicatesCfPage = patterns.cloudflare.some(regex => regex.test(bodySnippet))
  if (hasCfHeaders && (status === 403 || status === 503 || status === 429)) {
    return { category: 'cloudflare_block', reason: `HTTP ${status} with Cloudflare headers` }
  }
  if (indicatesCfPage) {
    return { category: 'cloudflare_block', reason: `Cloudflare challenge page detected` }
  }

  // Handle redirects (will be checked further in checkOne)
  if (status >= 300 && status < 400) {
    let loc = headers['location'] || ''
    
    // Handle relative redirects by making them absolute
    if (loc && !loc.startsWith('http')) {
      try {
        const baseUrl = new URL(url)
        if (loc.startsWith('/')) {
          loc = `${baseUrl.protocol}//${baseUrl.host}${loc}`
        } else {
          loc = `${baseUrl.protocol}//${baseUrl.host}/${loc}`
        }
      } catch (_) {}
    }
    
    const fromHost = getHostname(url)
    const toHost = getHostname(loc)
    const crossSite = fromHost && toHost && fromHost.toLowerCase() !== toHost.toLowerCase()
    return { 
      category: 'redirect', 
      reason: crossSite ? `Redirecting to other site (${toHost})` : 'Redirect', 
      redirectTo: loc,
      needsRedirectCheck: true
    }
  }

  // For HTTP 200 responses, check for JS/meta redirects and parked domains
  if (status === 200) {
    // Detect meta refresh redirects: <meta http-equiv="refresh" content="0;url=...">
    const metaRefreshMatch = bodySnippet.match(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)/i)
    if (metaRefreshMatch && metaRefreshMatch[1]) {
      let redirectUrl = metaRefreshMatch[1].replace(/["']/g, '')
      if (!redirectUrl.startsWith('http')) {
        try {
          const baseUrl = new URL(url)
          redirectUrl = redirectUrl.startsWith('/')
            ? `${baseUrl.protocol}//${baseUrl.host}${redirectUrl}`
            : `${baseUrl.protocol}//${baseUrl.host}/${redirectUrl}`
        } catch (_) {}
      }
      const fromHost = getHostname(url)
      const toHost = getHostname(redirectUrl)
      const crossSite = fromHost && toHost && fromHost.toLowerCase() !== toHost.toLowerCase()
      return {
        category: 'redirect',
        reason: crossSite ? `Meta refresh redirect to other site (${toHost})` : 'Meta refresh redirect',
        redirectTo: redirectUrl,
        needsRedirectCheck: true
      }
    }

    // Detect JavaScript redirects: window.location, location.href, location.replace
    const jsRedirectPatterns = [
      /window\.location\s*=\s*["']([^"']+)["']/i,
      /window\.location\.href\s*=\s*["']([^"']+)["']/i,
      /window\.location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
      /location\.href\s*=\s*["']([^"']+)["']/i,
      /location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
      /location\s*=\s*["']([^"']+)["']/i,
      /document\.location\s*=\s*["']([^"']+)["']/i,
      /document\.location\.href\s*=\s*["']([^"']+)["']/i
    ]

    for (const pattern of jsRedirectPatterns) {
      const match = bodySnippet.match(pattern)
      if (match && match[1]) {
        let redirectUrl = match[1]
        if (redirectUrl.startsWith('#') || redirectUrl.startsWith('javascript:')) continue
        if (!redirectUrl.startsWith('http')) {
          try {
            const baseUrl = new URL(url)
            redirectUrl = redirectUrl.startsWith('/')
              ? `${baseUrl.protocol}//${baseUrl.host}${redirectUrl}`
              : `${baseUrl.protocol}//${baseUrl.host}/${redirectUrl}`
          } catch (_) {}
        }
        const fromHost = getHostname(url)
        const toHost = getHostname(redirectUrl)
        const crossSite = fromHost && toHost && fromHost.toLowerCase() !== toHost.toLowerCase()
        return {
          category: 'redirect',
          reason: crossSite ? `JS redirect to other site (${toHost})` : 'JavaScript redirect',
          redirectTo: redirectUrl,
          needsRedirectCheck: true
        }
      }
    }

    // Detect parked domains with dynamic JS redirects (JSON-based delivery systems)
    const parkedPatterns = [
      /delivery\.method\s*===?\s*['"]redirect['"]/i,
      /window\.location\.href\s*=\s*data\.delivery\.destination/i,
      /\.delivery\.destination/i,
      /window\.location\.href\s*=\s*data\.[a-z]+\.destination/i,
      /sedoparking/i,
      /domainparking/i,
      /hugedomains/i,
      /afternic/i,
      /dan\.com/i,
      /buydomains/i,
      /This domain.*for sale/i,
      /domain.*parked/i,
      /parked.*domain/i,
      /This domain.*may be for sale/i
    ]

    const isParkedDomain = parkedPatterns.some(regex => regex.test(bodySnippet))
    if (isParkedDomain) {
      return {
        category: 'redirect',
        reason: 'Parked domain with dynamic JS redirect',
        redirectTo: null,
        needsRedirectCheck: false,
        isParkedDomain: true
      }
    }
  }

  // Check for fake "up" pages (200/302 but actually down)
  if ([200, 302].includes(status)) {
    const indicatesDown = patterns.pageNotFound.some(regex => regex.test(bodySnippet))
    if (indicatesDown) {
      return { category: 'down', reason: `HTTP ${status} but shows error page` }
    }
    return { category: 'up', reason: `HTTP ${status}` }
  }

  // 4xx/5xx
  if (status >= 500) {
    return { category: 'down', reason: `Server error HTTP ${status}` }
  }
  if (status >= 400) {
    return { category: 'down', reason: `Client error HTTP ${status}` }
  }
  
  return { category: 'up', reason: `HTTP ${status}` }
}

function extractWords(html, count = 20) {
  // Remove script, style tags and their content
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ')
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  // Remove extra whitespace
  text = text.replace(/\s+/g, ' ').trim()
  // Split into words and filter out empty strings
  const words = text.split(' ').filter(w => w.length > 0)
  // Return first 15-20 words
  const targetCount = Math.min(Math.max(15, Math.min(words.length, 20)), words.length)
  return words.slice(0, targetCount).join(' ')
}

// Fetch external JS files to check for dynamic JSON/JS redirect systems
async function checkExternalJsForRedirects(html, baseUrl, headers) {
  const scriptMatches = html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi)
  const parkedPatterns = [
    /delivery\.method\s*===?\s*['"]redirect['"]/i,
    /window\.location\.href\s*=\s*data\.delivery\.destination/i,
    /\.delivery\.destination/i,
    /window\.location\.href\s*=\s*data\.[a-z]+\.destination/i,
    /sedoparking/i,
    /domainparking/i
  ]

  for (const match of scriptMatches) {
    let scriptUrl = match[1]
    if (scriptUrl.startsWith('data:') || scriptUrl.includes('google.com') ||
        scriptUrl.includes('gstatic.com') || scriptUrl.includes('cloudflare')) {
      continue
    }
    if (!scriptUrl.startsWith('http')) {
      try {
        const base = new URL(baseUrl)
        scriptUrl = scriptUrl.startsWith('/')
          ? `${base.protocol}//${base.host}${scriptUrl}`
          : `${base.protocol}//${base.host}/${scriptUrl}`
      } catch (_) { continue }
    }
    try {
      const scriptHost = new URL(scriptUrl).hostname
      const baseHost = new URL(baseUrl).hostname
      if (scriptHost !== baseHost) continue
    } catch (_) { continue }

    try {
      console.log(`[JS-CHECK] Fetching external JS: ${scriptUrl}`)
      const jsResp = await fetch(scriptUrl, { timeout: 5000, headers })
      if (jsResp.ok) {
        const jsContent = await jsResp.text()
        const jsSnippet = jsContent.slice(0, 16384)
        for (const pattern of parkedPatterns) {
          if (pattern.test(jsSnippet)) {
            console.log(`[JS-CHECK] Found parked domain pattern in ${scriptUrl}`)
            return { isParked: true, scriptUrl }
          }
        }
      }
    } catch (e) {
      console.log(`[JS-CHECK] Failed to fetch ${scriptUrl}: ${e.message}`)
    }
  }
  return { isParked: false }
}

async function checkWithPuppeteer(url, takeScreenshot = false, scrapeText = false, originalUrls = [], detectUniqueRedirects = false) {
  const started = Date.now()
  let page = null

  console.log(`[PUPPETEER] ====== RECEIVED PARAMS ======`)
  console.log(`[PUPPETEER] url = ${url}`)
  console.log(`[PUPPETEER] originalUrls = ${JSON.stringify(originalUrls)}`)
  console.log(`[PUPPETEER] detectUniqueRedirects = ${detectUniqueRedirects}`)
  console.log(`[PUPPETEER] ==============================`)

  try {
    console.log(`[PUPPETEER] Starting check for ${url}`)
    const browser = await getBrowser()
    console.log(`[PUPPETEER] Got browser instance`)

    page = await browser.newPage()
    console.log(`[PUPPETEER] Created new page`)

    // Set viewport for consistent screenshots
    await page.setViewport({ width: 1280, height: 800 })

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')

    // Navigate and wait for network to be idle (catches JS/JSON redirects)
    console.log(`[PUPPETEER] Navigating to ${url}`)

    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      })
    } catch (navErr) {
      console.log(`[PUPPETEER] Navigation error, trying with domcontentloaded: ${navErr.message}`)
      // Retry with less strict wait condition
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })
    }

    // Wait for any delayed JS redirects
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get the final URL after all redirects
    let finalUrl = page.url()
    console.log(`[PUPPETEER] URL after first wait: ${finalUrl}`)

    // If URL hasn't changed, wait a bit more and check again (some redirects are slow)
    const originalRootCheck = getRootDomain(url)
    const firstCheckRoot = getRootDomain(finalUrl)
    if (originalRootCheck === firstCheckRoot) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      finalUrl = page.url()
      console.log(`[PUPPETEER] URL after second wait: ${finalUrl}`)
    }

    // Get page content for classification
    const bodySnippet = await page.content().then(c => c.slice(0, 8192)).catch(() => '')

    // Scrape text if enabled
    let scrapedText = null
    if (scrapeText) {
      try {
        const fullText = await page.content()
        scrapedText = extractWords(fullText)
        console.log(`[PUPPETEER] Scraped text: "${scrapedText.substring(0, 50)}..."`)
      } catch (_) {}
    }

    // Take screenshot if enabled
    let screenshot = null
    if (takeScreenshot) {
      try {
        const screenshotBuffer = await page.screenshot({
          type: 'png',
          fullPage: false // Just viewport, not full page
        })
        screenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`
        console.log(`[PUPPETEER] Screenshot taken (${Math.round(screenshotBuffer.length / 1024)}KB)`)
      } catch (err) {
        console.log(`[PUPPETEER] Screenshot failed: ${err.message}`)
      }
    }

    // Classify the final page based on content patterns
    // Check for common patterns
    const hasCfPattern = /Just a moment\.\.\.|Attention Required! \| Cloudflare|checking your browser|cdn-cgi\//i.test(bodySnippet)
    const hasDownPattern = /Page Not Found|404 Not Found|Welcome to nginx!|Apache.*Test Page|It works!/i.test(bodySnippet)

    let category = 'up'
    let reason = 'HTTP 200 (via Puppeteer)'

    if (hasCfPattern) {
      category = 'cloudflare_block'
      reason = 'Cloudflare challenge page detected (via Puppeteer)'
    } else if (hasDownPattern) {
      category = 'down'
      reason = 'Error page detected (via Puppeteer)'
    }

    // Check if this was a redirect (ignore trailing slash differences)
    const originalRootDomain = getRootDomain(url)
    const finalRootDomain = getRootDomain(finalUrl)
    const isSameDomain = originalRootDomain === finalRootDomain

    // Normalize URLs: remove trailing slashes and compare
    const normalizeForComparison = (u) => {
      try {
        const parsed = new URL(u)
        // Remove trailing slash from pathname
        let path = parsed.pathname.replace(/\/+$/, '') || ''
        return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`.replace(/\/+$/, '')
      } catch (_) {
        return u.replace(/\/+$/, '').toLowerCase()
      }
    }

    const normalizedOriginal = normalizeForComparison(url)
    const normalizedFinal = normalizeForComparison(finalUrl)
    const urlChanged = normalizedOriginal !== normalizedFinal

    // If same domain (just different path like /home), it's UP not a redirect
    // Only mark as redirect if going to a DIFFERENT domain
    const isCrossDomainRedirect = urlChanged && !isSameDomain

    if (isCrossDomainRedirect && category === 'up') {
      category = 'redirect_up'
      reason = `JS/Meta redirect to ${finalRootDomain} (via Puppeteer)`
    }

    // FALLBACK: If browser didn't redirect, scan HTML for JS/meta redirect patterns
    // This catches cases where the server/geo blocks the redirect in-browser
    let detectedRedirectUrl = isCrossDomainRedirect ? finalUrl : null
    if (!isCrossDomainRedirect && category === 'up') {
      console.log(`[PUPPETEER] No URL change detected, scanning HTML for redirect patterns...`)
      // Check for meta refresh
      const metaMatch = bodySnippet.match(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)/i)
      if (metaMatch && metaMatch[1]) {
        let rUrl = metaMatch[1].replace(/["']/g, '')
        if (!rUrl.startsWith('http')) {
          try { const b = new URL(url); rUrl = rUrl.startsWith('/') ? `${b.protocol}//${b.host}${rUrl}` : `${b.protocol}//${b.host}/${rUrl}` } catch (_) {}
        }
        const rDomain = getRootDomain(rUrl)
        if (rDomain !== originalRootDomain) {
          detectedRedirectUrl = rUrl
          category = 'redirect_up'
          reason = `Meta refresh redirect to ${rDomain} (via Puppeteer)`
          console.log(`[PUPPETEER] Found meta refresh redirect in HTML: ${rUrl}`)
        }
      }
      // Check for JS redirects (window.location, etc.)
      if (!detectedRedirectUrl) {
        const jsPatterns = [
          /window\.location\s*=\s*["']([^"']+)["']/i,
          /window\.location\.href\s*=\s*["']([^"']+)["']/i,
          /window\.location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
          /location\.href\s*=\s*["']([^"']+)["']/i,
          /location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
          /document\.location\s*=\s*["']([^"']+)["']/i,
          /document\.location\.href\s*=\s*["']([^"']+)["']/i
        ]
        for (const pat of jsPatterns) {
          const m = bodySnippet.match(pat)
          if (m && m[1] && !m[1].startsWith('#') && !m[1].startsWith('javascript:')) {
            let rUrl = m[1]
            if (!rUrl.startsWith('http')) {
              try { const b = new URL(url); rUrl = rUrl.startsWith('/') ? `${b.protocol}//${b.host}${rUrl}` : `${b.protocol}//${b.host}/${rUrl}` } catch (_) {}
            }
            const rDomain = getRootDomain(rUrl)
            if (rDomain !== originalRootDomain) {
              detectedRedirectUrl = rUrl
              category = 'redirect_up'
              reason = `JS redirect to ${rDomain} (via Puppeteer)`
              console.log(`[PUPPETEER] Found JS redirect in HTML: ${rUrl}`)
              break
            }
          }
        }
      }
    }

    const effectiveCrossDomain = isCrossDomainRedirect || !!detectedRedirectUrl

    // Check for unique redirect - only for cross-domain redirects
    console.log(`[PUPPETEER] About to check unique redirect:`)
    console.log(`[PUPPETEER]   isCrossDomainRedirect = ${effectiveCrossDomain}`)
    console.log(`[PUPPETEER]   redirectUrl = ${detectedRedirectUrl}`)
    console.log(`[PUPPETEER]   originalUrls length = ${originalUrls?.length}`)
    console.log(`[PUPPETEER]   detectUniqueRedirects = ${detectUniqueRedirects}`)
    const isUnique = effectiveCrossDomain ? isUniqueRedirect(detectedRedirectUrl || finalUrl, url, originalUrls, detectUniqueRedirects) : false
    console.log(`[PUPPETEER]   isUnique result = ${isUnique}`)

    await page.close()

    return {
      url,
      httpStatus: 200,
      category,
      reason,
      redirectTo: detectedRedirectUrl,
      finalDestination: detectedRedirectUrl,
      scrapedText,
      screenshot,
      isUniqueRedirect: isUnique,
      timeMs: Date.now() - started
    }

  } catch (err) {
    console.log(`[PUPPETEER] Error checking ${url}: ${err.message}`)
    console.log(`[PUPPETEER] Error stack: ${err.stack}`)

    if (page) {
      try { await page.close() } catch (_) {}
    }

    // If browser crashed, clear the instance so it can be recreated
    if (err.message.includes('Target closed') || err.message.includes('Session closed') || err.message.includes('Protocol error')) {
      console.log('[PUPPETEER] Browser appears crashed, clearing instance')
      browserInstance = null
    }

    return {
      url,
      httpStatus: 0,
      category: 'down',
      reason: err.message.includes('timeout') || err.message.includes('Timeout')
        ? 'Timeout (Puppeteer)'
        : `Error: ${err.message.substring(0, 100)}`,
      redirectTo: null,
      scrapedText: null,
      screenshot: null,
      isUniqueRedirect: false,
      timeMs: Date.now() - started
    }
  }
}

async function checkWithPuppeteerVariations(baseUrl, takeScreenshot = false, scrapeText = false, originalUrls = [], detectUniqueRedirects = false) {
  const variations = generateVariations(baseUrl)
  const variationResults = []
  let screenshotTaken = null
  let screenshotUrl = null

  console.log(`[PUPPETEER-VAR] Checking 4 variations for ${baseUrl}`)

  // Check all 4 variations
  for (const varUrl of variations) {
    // Only take screenshot if we haven't taken one yet AND this variation might be "up"
    const shouldTakeScreenshot = takeScreenshot && !screenshotTaken
    const result = await checkWithPuppeteer(varUrl, shouldTakeScreenshot, scrapeText, originalUrls, detectUniqueRedirects)
    variationResults.push(result)
    console.log(`[PUPPETEER-VAR] ${varUrl} → ${result.category}`)

    // Save screenshot from first "up" result
    if (shouldTakeScreenshot && result.screenshot && result.category === 'up') {
      screenshotTaken = result.screenshot
      screenshotUrl = varUrl
      console.log(`[PUPPETEER-VAR] Screenshot taken from UP variation: ${varUrl}`)
    }
  }

  // If no "up" screenshot, try to get one from redirect_up
  if (takeScreenshot && !screenshotTaken) {
    const redirectUpResult = variationResults.find(r => r.category === 'redirect_up' && r.screenshot)
    if (redirectUpResult) {
      screenshotTaken = redirectUpResult.screenshot
      screenshotUrl = redirectUpResult.url
      console.log(`[PUPPETEER-VAR] Screenshot taken from REDIRECT_UP variation: ${screenshotUrl}`)
    } else {
      // Take screenshot from first variation that has one
      const anyScreenshot = variationResults.find(r => r.screenshot)
      if (anyScreenshot) {
        screenshotTaken = anyScreenshot.screenshot
        screenshotUrl = anyScreenshot.url
      }
    }
  }

  // Determine best result (priority: up > redirect_up > cloudflare_block > redirect_down > down)
  const mainResult = variationResults.find(r => r.category === 'up') ||
    variationResults.find(r => r.category === 'redirect_up') ||
    variationResults.find(r => r.category === 'cloudflare_block') ||
    variationResults.find(r => r.category === 'redirect_down') ||
    variationResults[0]

  // Create clean variation summaries
  const cleanVariations = variationResults.map(v => ({
    url: v.url,
    httpStatus: v.httpStatus,
    category: v.category,
    reason: v.reason,
    timeMs: v.timeMs,
    redirectTo: v.redirectTo || null,
    finalDestination: v.finalDestination || null,
    isUniqueRedirect: v.isUniqueRedirect || false
  }))

  // Get final destination from best result
  let finalDestination = null
  const upResult = variationResults.find(r => r.category === 'up' || r.category === 'redirect_up')
  if (upResult && upResult.finalDestination) {
    finalDestination = upResult.finalDestination
  }

  return {
    ...mainResult,
    url: mainResult.url,
    baseUrl: stripUrl(baseUrl),
    variations: cleanVariations,
    finalDestination,
    screenshot: screenshotTaken, // Use the single screenshot we took
    isUniqueRedirect: finalDestination ? isUniqueRedirect(finalDestination, mainResult.url, originalUrls, detectUniqueRedirects) : false
  }
}

function isUniqueRedirect(redirectUrl, originalUrl, originalUrls, detectUniqueRedirects) {
  // Feature must be enabled
  if (!detectUniqueRedirects) return false
  if (!redirectUrl || !originalUrls || originalUrls.length === 0) return false

  // Get root domain of where we're redirecting TO
  const redirectDomain = getRootDomain(redirectUrl)
  console.log(`[UNIQUE CHECK] Redirect goes to: ${redirectUrl} (domain: ${redirectDomain})`)
  console.log(`[UNIQUE CHECK] User's list has ${originalUrls.length} URLs`)

  // Simple check: is the redirect domain in the user's list?
  for (let i = 0; i < originalUrls.length; i++) {
    const listUrl = originalUrls[i]
    const listDomain = getRootDomain(listUrl)
    console.log(`[UNIQUE CHECK]   Comparing with list[${i}]: ${listUrl} (domain: ${listDomain})`)

    if (redirectDomain === listDomain) {
      console.log(`[UNIQUE CHECK] ✓ FOUND IN LIST! ${redirectDomain} === ${listDomain} → NOT unique`)
      return false  // Found in list = NOT unique
    }
  }

  // Not found in list = IS unique
  console.log(`[UNIQUE CHECK] ✗ NOT IN LIST! ${redirectDomain} is unique`)
  return true
}

async function checkOne(url, scrapeText = false, checkRedirectsGeo = true, originalUrls = [], detectUniqueRedirects = false) {
  const started = Date.now()
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
  try {
    const resp = await fetch(url, { redirect: 'manual', timeout: 10000, headers, agent: httpsAgent })
    let bodySnippet = ''
    let fullText = ''
    let scrapedText = null
    
    // Always get body for pattern matching
    try {
      fullText = await resp.text()
      bodySnippet = fullText.slice(0, 8192) // Increased for better pattern matching
      // Scrape from ANY response if scraping is enabled (including Cloudflare, geo-blocked, errors)
      if (scrapeText && fullText) {
        scrapedText = extractWords(fullText)
        console.log(`[SCRAPE] Scraped from original page: "${scrapedText.substring(0, 50)}..."`)
      }
    } catch (_) {}
    
    let cls = classifyStatus(resp, bodySnippet, url)

    // If classified as "up" at 200, also check external JS for parked domain patterns
    if (checkRedirectsGeo && cls.category === 'up' && resp.status === 200) {
      const jsCheck = await checkExternalJsForRedirects(fullText, url, headers)
      if (jsCheck.isParked) {
        console.log(`[PARKED] Detected parked domain via external JS: ${url}`)
        cls = {
          category: 'redirect',
          reason: 'Parked domain with dynamic JS redirect (detected in external script)',
          redirectTo: null,
          needsRedirectCheck: false,
          isParkedDomain: true
        }
      }
    }

    // Handle parked domains (no redirect to follow, just mark as down)
    if (cls.isParkedDomain) {
      return {
        url,
        httpStatus: resp.status,
        category: 'redirect_down',
        reason: cls.reason,
        redirectTo: null,
        finalDestination: null,
        isParkedDomain: true,
        scrapedText: scrapedText,
        isUniqueRedirect: false,
        timeMs: Date.now() - started
      }
    }

    // If it's a redirect, check the redirect destination (only if enabled)
    if (checkRedirectsGeo && cls.needsRedirectCheck && cls.redirectTo) {
      console.log(`[REDIRECT] Checking redirect from ${url} to ${cls.redirectTo}`)

      // Get original root domain for same-domain comparison
      const originalRootDomain = getRootDomain(url)
      
      try {
        const redirectResp = await fetch(cls.redirectTo, { redirect: 'manual', timeout: 10000, headers, agent: httpsAgent })
        let redirectBody = ''
        try {
          const redirectText = await redirectResp.text()
          redirectBody = redirectText.slice(0, 8192)
          // ALWAYS scrape from redirect destination if scraping is enabled (overwrites original)
          if (scrapeText && redirectText) {
            scrapedText = extractWords(redirectText)
            console.log(`[SCRAPE] Scraped from 1st redirect destination (${redirectResp.status}): "${scrapedText.substring(0, 50)}..."`)
          }
        } catch (_) {}
        
        const redirectCls = classifyStatus(redirectResp, redirectBody, cls.redirectTo)
        console.log(`[REDIRECT] Destination status: ${redirectResp.status}, Category: ${redirectCls.category}`)
        
        // If the redirect destination is ALSO a redirect, follow it one more time (2nd level)
        if (redirectCls.needsRedirectCheck && redirectCls.redirectTo) {
          console.log(`[REDIRECT] Following 2nd redirect from ${cls.redirectTo} to ${redirectCls.redirectTo}`)
          try {
            const redirect2Resp = await fetch(redirectCls.redirectTo, { redirect: 'manual', timeout: 10000, headers, agent: httpsAgent })
            let redirect2Body = ''
            try {
              const redirect2Text = await redirect2Resp.text()
              redirect2Body = redirect2Text.slice(0, 8192)
              // ALWAYS scrape from 2nd redirect destination (overwrites previous)
              if (scrapeText && redirect2Text) {
                scrapedText = extractWords(redirect2Text)
                console.log(`[SCRAPE] Scraped from 2nd redirect destination (${redirect2Resp.status}): "${scrapedText.substring(0, 50)}..."`)
              }
            } catch (_) {}
            
            const redirect2Cls = classifyStatus(redirect2Resp, redirect2Body, redirectCls.redirectTo)
            console.log(`[REDIRECT] 2nd destination status: ${redirect2Resp.status}, Category: ${redirect2Cls.category}`)
            
            // If 2nd redirect is ALSO a redirect, follow it one more time (3rd level)
            if (redirect2Cls.needsRedirectCheck && redirect2Cls.redirectTo) {
              console.log(`[REDIRECT] Following 3rd redirect from ${redirectCls.redirectTo} to ${redirect2Cls.redirectTo}`)
              try {
                const redirect3Resp = await fetch(redirect2Cls.redirectTo, { redirect: 'manual', timeout: 10000, headers, agent: httpsAgent })
                let redirect3Body = ''
                try {
                  const redirect3Text = await redirect3Resp.text()
                  redirect3Body = redirect3Text.slice(0, 8192)
                  // ALWAYS scrape from 3rd redirect destination (final, overwrites all previous)
                  if (scrapeText && redirect3Text) {
                    scrapedText = extractWords(redirect3Text)
                    console.log(`[SCRAPE] Scraped from 3rd redirect destination (${redirect3Resp.status}): "${scrapedText.substring(0, 50)}..."`)
                  }
      } catch (_) {}
                
                const redirect3Cls = classifyStatus(redirect3Resp, redirect3Body, redirect2Cls.redirectTo)
                console.log(`[REDIRECT] 3rd destination status: ${redirect3Resp.status}, Category: ${redirect3Cls.category}`)
                
                // Use the 3rd redirect result (final)
                if (redirect3Cls.category === 'up') {
                  // Check if final destination is same domain as original
                  const finalRootDomain = getRootDomain(redirect2Cls.redirectTo)
                  const isSameDomain = originalRootDomain === finalRootDomain
                  const isCrossDomainRedirect = !isSameDomain

                  // Only check unique redirect for cross-domain redirects
                  const isUnique = isCrossDomainRedirect ? isUniqueRedirect(redirect2Cls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

                  console.log(`[REDIRECT] ✓ 3rd redirect destination is UP (same domain: ${isSameDomain})`)
                  return {
                    url,
                    httpStatus: resp.status,
                    category: isSameDomain ? 'up' : 'redirect_up',
                    reason: isSameDomain ? redirect3Cls.reason : `Redirect → Redirect → Redirect → ${redirect3Cls.reason}`,
                    redirectTo: isCrossDomainRedirect ? redirect2Cls.redirectTo : null,
                    redirectStatus: redirect3Resp.status,
                    scrapedText: scrapedText,
                    isUniqueRedirect: isUnique,
                    timeMs: Date.now() - started
                  }
                } else {
                  // Check if final destination is same domain as original
                  const finalRootDomain = getRootDomain(redirect2Cls.redirectTo)
                  const isCrossDomainRedirect = originalRootDomain !== finalRootDomain
                  const isUnique = isCrossDomainRedirect ? isUniqueRedirect(redirect2Cls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

                  console.log(`[REDIRECT] ✗ 3rd redirect destination is DOWN/OTHER: ${redirect3Cls.category}`)
                  return {
                    url,
                    httpStatus: resp.status,
                    category: 'redirect_down',
                    reason: `Redirect → Redirect → Redirect → ${redirect3Cls.reason}`,
                    redirectTo: isCrossDomainRedirect ? redirect2Cls.redirectTo : null,
                    redirectStatus: redirect3Resp.status,
                    scrapedText: scrapedText,
                    isUniqueRedirect: isUnique,
                    timeMs: Date.now() - started
                  }
                }
              } catch (redirect3Err) {
                // Check if final destination is same domain as original
                const finalRootDomain = getRootDomain(redirect2Cls.redirectTo)
                const isCrossDomainRedirect = originalRootDomain !== finalRootDomain
                const isUnique = isCrossDomainRedirect ? isUniqueRedirect(redirect2Cls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

                console.log(`[REDIRECT] ✗ 3rd redirect failed: ${redirect3Err.message}`)
                return {
                  url,
                  httpStatus: resp.status,
                  category: 'redirect_down',
                  reason: `Redirect → Redirect → Redirect → Unreachable`,
                  redirectTo: isCrossDomainRedirect ? redirect2Cls.redirectTo : null,
                  redirectStatus: 0,
                  scrapedText: scrapedText,
                  isUniqueRedirect: isUnique,
                  timeMs: Date.now() - started
                }
              }
            }
            
            // Use the 2nd redirect result
            if (redirect2Cls.category === 'up') {
              // Check if final destination is same domain as original
              const finalRootDomain = getRootDomain(redirectCls.redirectTo)
              const isSameDomain = originalRootDomain === finalRootDomain
              const isCrossDomainRedirect = !isSameDomain

              // Only check unique redirect for cross-domain redirects
              const isUnique = isCrossDomainRedirect ? isUniqueRedirect(redirectCls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

              console.log(`[REDIRECT] ✓ 2nd redirect destination is UP (same domain: ${isSameDomain})`)
              return {
                url,
                httpStatus: resp.status,
                category: isSameDomain ? 'up' : 'redirect_up',
                reason: isSameDomain ? redirect2Cls.reason : `Redirect → Redirect → ${redirect2Cls.reason}`,
                redirectTo: isCrossDomainRedirect ? redirectCls.redirectTo : null,
                redirectStatus: redirect2Resp.status,
                scrapedText: scrapedText,
                isUniqueRedirect: isUnique,
                timeMs: Date.now() - started
              }
            } else {
              // Check if final destination is same domain as original
              const finalRootDomain = getRootDomain(redirectCls.redirectTo)
              const isCrossDomainRedirect = originalRootDomain !== finalRootDomain
              const isUnique = isCrossDomainRedirect ? isUniqueRedirect(redirectCls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

              console.log(`[REDIRECT] ✗ 2nd redirect destination is DOWN/OTHER: ${redirect2Cls.category}`)
              return {
                url,
                httpStatus: resp.status,
                category: 'redirect_down',
                reason: `Redirect → Redirect → ${redirect2Cls.reason}`,
                redirectTo: isCrossDomainRedirect ? redirectCls.redirectTo : null,
                redirectStatus: redirect2Resp.status,
                scrapedText: scrapedText,
                isUniqueRedirect: isUnique,
                timeMs: Date.now() - started
              }
            }
          } catch (redirect2Err) {
            // Check if final destination is same domain as original
            const finalRootDomain = getRootDomain(redirectCls.redirectTo)
            const isCrossDomainRedirect = originalRootDomain !== finalRootDomain
            const isUnique = isCrossDomainRedirect ? isUniqueRedirect(redirectCls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

            console.log(`[REDIRECT] ✗ 2nd redirect failed: ${redirect2Err.message}`)
            return {
              url,
              httpStatus: resp.status,
              category: 'redirect_down',
              reason: `Redirect → Redirect → Unreachable`,
              redirectTo: isCrossDomainRedirect ? redirectCls.redirectTo : null,
              redirectStatus: 0,
              scrapedText: scrapedText,
              isUniqueRedirect: isUnique,
              timeMs: Date.now() - started
            }
          }
        }
        
        // Determine if redirect destination is up or down (1st level only)
        if (redirectCls.category === 'up') {
          // Check if final destination is same domain as original
          const finalRootDomain = getRootDomain(cls.redirectTo)
          const isSameDomain = originalRootDomain === finalRootDomain
          const isCrossDomainRedirect = !isSameDomain

          // Only check unique redirect for cross-domain redirects
          const isUnique = isCrossDomainRedirect ? isUniqueRedirect(cls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

          console.log(`[REDIRECT] ✓ Redirect destination is UP (same domain: ${isSameDomain})`)
          return {
            url,
            httpStatus: resp.status,
            category: isSameDomain ? 'up' : 'redirect_up',
            reason: isSameDomain ? redirectCls.reason : `Redirect → ${redirectCls.reason}`,
            redirectTo: isCrossDomainRedirect ? cls.redirectTo : null,
            redirectStatus: redirectResp.status,
            scrapedText: scrapedText,
            isUniqueRedirect: isUnique,
            timeMs: Date.now() - started
          }
        } else {
          // Check if final destination is same domain as original
          const finalRootDomain = getRootDomain(cls.redirectTo)
          const isCrossDomainRedirect = originalRootDomain !== finalRootDomain
          const isUnique = isCrossDomainRedirect ? isUniqueRedirect(cls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

          // Anything other than 'up' is considered redirect_down (down, cloudflare, geo, or another redirect)
          console.log(`[REDIRECT] ✗ Redirect destination is DOWN/OTHER: ${redirectCls.category}`)
          return {
            url,
            httpStatus: resp.status,
            category: 'redirect_down',
            reason: `Redirect → ${redirectCls.reason}`,
            redirectTo: isCrossDomainRedirect ? cls.redirectTo : null,
            redirectStatus: redirectResp.status,
            scrapedText: scrapedText,
            isUniqueRedirect: isUnique,
            timeMs: Date.now() - started
          }
        }
      } catch (redirectErr) {
        // Check if final destination is same domain as original
        const finalRootDomain = getRootDomain(cls.redirectTo)
        const isCrossDomainRedirect = originalRootDomain !== finalRootDomain
        const isUnique = isCrossDomainRedirect ? isUniqueRedirect(cls.redirectTo, url, originalUrls, detectUniqueRedirects) : false

        // Redirect destination unreachable
        return {
          url,
          httpStatus: resp.status,
          category: 'redirect_down',
          reason: `Redirect → Unreachable (${redirectErr.message || 'Network error'})`,
          redirectTo: isCrossDomainRedirect ? cls.redirectTo : null,
          redirectStatus: 0,
          scrapedText: scrapedText,
          isUniqueRedirect: isUnique,
          timeMs: Date.now() - started
        }
      }
    }
    
    const result = {
      url,
      httpStatus: resp.status,
      category: cls.category,
      reason: cls.reason,
      redirectTo: cls.redirectTo || null,
      scrapedText: scrapedText,
      isUniqueRedirect: false,
      timeMs: Date.now() - started
    }
    return result
  } catch (err) {
    const result = {
      url,
      httpStatus: 0,
      category: 'down',
      reason: err.type === 'request-timeout' ? 'Timeout' : (err.message || 'Network error'),
      redirectTo: null,
      scrapedText: null,
      isUniqueRedirect: false,
      timeMs: Date.now() - started
    }
    return result
  }
}

async function checkWithVariations(baseUrl, scrapeText, checkRedirectsGeo, originalUrls = [], detectUniqueRedirects = false) {
  const variations = generateVariations(baseUrl)
  const variationResults = []
  let mainResult = null
  
  // Check ALL 4 variations (don't stop early)
  for (const varUrl of variations) {
    const result = await checkOne(varUrl, scrapeText, checkRedirectsGeo, originalUrls, detectUniqueRedirects)
    variationResults.push(result)
    console.log(`[VARIATION] ${varUrl} → ${result.category} (${result.httpStatus})`)
  }
  
  // Determine which result to use as the main one
  // Priority: up > redirect_up > cloudflare_block > redirect_down > down
  mainResult = variationResults.find(r => r.category === 'up') ||
               variationResults.find(r => r.category === 'redirect_up') ||
               variationResults.find(r => r.category === 'cloudflare_block') ||
               variationResults.find(r => r.category === 'redirect_down') ||
               variationResults[0]
  
  // Create clean variation summaries (avoid circular references)
  const cleanVariations = variationResults.map(v => ({
    url: v.url,
    httpStatus: v.httpStatus,
    category: v.category,
    reason: v.reason,
    timeMs: v.timeMs,
    redirectTo: v.redirectTo || null,
    isUniqueRedirect: v.isUniqueRedirect || false
  }))
  
  // Determine the final destination URL (most common redirectTo, or from the best result)
  let finalDestination = null
  const redirectDestinations = variationResults
    .map(v => v.redirectTo)
    .filter(Boolean)
  
  if (redirectDestinations.length > 0) {
    // Find most common redirect destination
    const destinationCounts = {}
    redirectDestinations.forEach(dest => {
      destinationCounts[dest] = (destinationCounts[dest] || 0) + 1
    })
    
    // Get the most common one, or prefer the one from 'up' or 'redirect_up' results
    const upResult = variationResults.find(r => r.category === 'up' || r.category === 'redirect_up')
    if (upResult && upResult.redirectTo) {
      finalDestination = upResult.redirectTo
    } else {
      // Get most frequent
      finalDestination = Object.keys(destinationCounts).reduce((a, b) => 
        destinationCounts[a] > destinationCounts[b] ? a : b
      )
    }
  }
  
  // Add variations info and final destination to main result
  mainResult.variations = cleanVariations
  mainResult.baseUrl = stripUrl(baseUrl)
  mainResult.finalDestination = finalDestination
  
  // Check if the final destination is unique (only if detection is enabled)
  if (finalDestination && detectUniqueRedirects) {
    mainResult.isUniqueRedirect = isUniqueRedirect(finalDestination, baseUrl, originalUrls, detectUniqueRedirects)
  }
  
  return mainResult
}

app.post('/api/check', async (req, res) => {
  const urls = Array.isArray(req.body.urls) ? req.body.urls : []
  const scrapeText = req.body.scrapeText === true
  const tryAllVariations = req.body.tryAllVariations === true
  const checkRedirectsGeo = req.body.checkRedirectsGeo !== false // Default true
  const detectUniqueRedirects = req.body.detectUniqueRedirects === true
  const advancedRedirects = req.body.advancedRedirects === true
  const puppeteerScreenshot = req.body.puppeteerScreenshot === true

  const normalized = urls.map(normalizeUrl).filter(Boolean)
  if (normalized.length === 0) {
    return res.status(400).json({ error: 'No valid URLs provided' })
  }

  // Use the full URL list for unique redirect comparison (not just this batch)
  const allUrls = Array.isArray(req.body.allUrls) ? req.body.allUrls : urls
  const allNormalized = allUrls.map(normalizeUrl).filter(Boolean)

  // Use smaller batch size for Puppeteer (more resource intensive)
  const limit = advancedRedirects ? 2 : 5
  const out = []

  if (advancedRedirects && tryAllVariations) {
    // Puppeteer + 4 variations mode
    console.log(`[API] Using Puppeteer + 4 Variations mode (screenshot: ${puppeteerScreenshot}) for ${normalized.length} URLs`)
    for (let i = 0; i < normalized.length; i++) {
      const url = normalized[i]
      console.log(`[API] Puppeteer+Variations checking ${i + 1}/${normalized.length}: ${url}`)
      try {
        const result = await checkWithPuppeteerVariations(url, puppeteerScreenshot, scrapeText, allNormalized, detectUniqueRedirects)
        out.push(result)
        console.log(`[API] Puppeteer+Variations result for ${url}: ${result.category}`)
      } catch (err) {
        console.log(`[API] Puppeteer+Variations failed for ${url}: ${err.message}`)
        out.push({
          url,
          httpStatus: 0,
          category: 'down',
          reason: `Puppeteer error: ${err.message}`,
          redirectTo: null,
          scrapedText: null,
          screenshot: null,
          isUniqueRedirect: false,
          timeMs: 0
        })
      }
    }
  } else if (advancedRedirects) {
    // Use Puppeteer for advanced redirect following (JS/JSON redirects)
    // Process ONE at a time to avoid browser resource issues
    console.log(`[API] Using Puppeteer mode (screenshot: ${puppeteerScreenshot}) for ${normalized.length} URLs`)
    console.log(`[API] detectUniqueRedirects = ${detectUniqueRedirects}`)
    console.log(`[API] Full URL list being passed:`, allNormalized)
    for (let i = 0; i < normalized.length; i++) {
      const url = normalized[i]
      console.log(`[API] Puppeteer checking ${i + 1}/${normalized.length}: ${url}`)
      try {
        const result = await checkWithPuppeteer(url, puppeteerScreenshot, scrapeText, allNormalized, detectUniqueRedirects)
        out.push(result)
        console.log(`[API] Puppeteer result for ${url}: ${result.category}`)
      } catch (err) {
        console.log(`[API] Puppeteer failed for ${url}: ${err.message}`)
        out.push({
          url,
          httpStatus: 0,
          category: 'down',
          reason: `Puppeteer error: ${err.message}`,
          redirectTo: null,
          scrapedText: null,
          screenshot: null,
          isUniqueRedirect: false,
          timeMs: 0
        })
      }
    }
  } else if (tryAllVariations) {
    // Check all variations for each URL
    for (let i = 0; i < normalized.length; i += limit) {
      const batch = normalized.slice(i, i + limit)
      const results = await Promise.all(batch.map(u => checkWithVariations(u, scrapeText, checkRedirectsGeo, allNormalized, detectUniqueRedirects)))
      out.push(...results)
    }
  } else {
    // Normal single check
    for (let i = 0; i < normalized.length; i += limit) {
      const batch = normalized.slice(i, i + limit)
      const results = await Promise.all(batch.map(u => checkOne(u, scrapeText, checkRedirectsGeo, allNormalized, detectUniqueRedirects)))
      out.push(...results)
    }
  }

  // Force dead/seized/parked/sale domains to "down" regardless of HTTP status
  for (const result of out) {
    // Check the original URL, redirect destination, and final destination
    const urlsToCheck = [result.url, result.redirectTo, result.finalDestination].filter(Boolean)
    for (const u of urlsToCheck) {
      const deadReason = isDeadDomain(u)
      if (deadReason) {
        result.category = 'down'
        result.reason = deadReason
        result.isUniqueRedirect = false
        break
      }
    }
  }

  res.json({ results: out })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

