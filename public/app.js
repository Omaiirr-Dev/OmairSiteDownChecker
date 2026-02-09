const el = (sel) => document.querySelector(sel)
const urlsEl = el('#urls')
const btn = el('#checkBtn')
const clearBtn = el('#clearBtn')
const progressEl = el('#progress')
const resultsEl = el('#results')
const enteredCountEl = el('#entered-count')
const checkedCountEl = el('#checked-count')
const timeTakenEl = el('#time-taken')
const tryAllVariationsEl = el('#tryAllVariations')
const checkRedirectsGeoEl = el('#checkRedirectsGeo')
const detectUniqueRedirectsEl = el('#detectUniqueRedirects')
const advancedRedirectsEl = el('#advancedRedirects')
const puppeteerScreenshotEl = el('#puppeteerScreenshot')
const puppeteerLabelEl = el('#puppeteerLabel')
const warningContainer = el('#warning-container')
const notificationContainer = el('#notification-container')

// Screenshot gallery elements
const screenshotModal = el('#screenshotModal')
const screenshotModalTitle = el('#screenshotModalTitle')
const screenshotCounter = el('#screenshotCounter')
const screenshotImage = el('#screenshotImage')
const screenshotUrl = el('#screenshotUrl')
const screenshotPrev = el('#screenshotPrev')
const screenshotNext = el('#screenshotNext')
const screenshotModalOverlay = screenshotModal ? screenshotModal.querySelector('.modal-overlay') : null
const screenshotModalClose = screenshotModal ? screenshotModal.querySelector('.modal-close') : null

// Screenshot data storage - keyed by URL for easy lookup/movement
let screenshotsByUrl = {} // { url: screenshot }
let screenshotData = {
  up: [],
  redirect_up: [],
  redirect_down: [],
  unique_redirect: [],
  cloudflare_block: [],
  down: []
}
let currentGallery = { category: '', index: 0 }

// Send-to elements
const screenshotSendTo = el('#screenshotSendTo')
const screenshotSendBtn = el('#screenshotSendBtn')

// LocalStorage keys
const STORAGE_KEYS = {
  RESULTS: 'siteChecker_results',
  URLS: 'siteChecker_urls',
  STATE: 'siteChecker_state',
  SCREENSHOTS: 'siteChecker_screenshots'
}

// Checkbox dependency: Puppeteer only enabled when Advanced Redirects is checked
if (advancedRedirectsEl && puppeteerScreenshotEl && puppeteerLabelEl) {
  advancedRedirectsEl.addEventListener('change', () => {
    if (advancedRedirectsEl.checked) {
      puppeteerScreenshotEl.disabled = false
      puppeteerLabelEl.classList.remove('checkbox-label-disabled')
      // Check if variations is enabled and warn user
      checkPuppeteerVariationsConflict()
    } else {
      puppeteerScreenshotEl.checked = false
      puppeteerScreenshotEl.disabled = true
      puppeteerLabelEl.classList.add('checkbox-label-disabled')
    }
  })

  // Also check when Puppeteer is toggled
  puppeteerScreenshotEl.addEventListener('change', () => {
    if (puppeteerScreenshotEl.checked) {
      checkPuppeteerVariationsConflict()
    }
  })
}

// Warning modal elements
const warningModal = el('#warningModal')
const warningKeepBtn = el('#warningKeep')
const warningDisableBtn = el('#warningDisable')

// Warn when both Puppeteer and 4 Variations are enabled
function checkPuppeteerVariationsConflict() {
  if (advancedRedirectsEl?.checked && puppeteerScreenshotEl?.checked && tryAllVariationsEl?.checked) {
    warningModal.classList.add('show')
  }
}

// Warning modal handlers
if (warningKeepBtn) {
  warningKeepBtn.addEventListener('click', () => {
    warningModal.classList.remove('show')
  })
}

if (warningDisableBtn) {
  warningDisableBtn.addEventListener('click', () => {
    tryAllVariationsEl.checked = false
    warningModal.classList.remove('show')
    showNotification('4 variations disabled')
  })
}

// Also warn if user enables variations while Puppeteer is already on
if (tryAllVariationsEl) {
  tryAllVariationsEl.addEventListener('change', () => {
    if (tryAllVariationsEl.checked) {
      checkPuppeteerVariationsConflict()
    }
  })
}
const tbUp = el('#tbody-up')
const tbRedirectUp = el('#tbody-redirect_up')
const tbRedirectDown = el('#tbody-redirect_down')
const tbUniqueRedirect = el('#tbody-unique_redirect')
const tbCf = el('#tbody-cloudflare_block')
const tbDown = el('#tbody-down')
const tableBoxes = Array.from(document.querySelectorAll('.table-box'))
const copyBtns = Array.from(document.querySelectorAll('.copy-btn'))
const chartCanvas = document.getElementById('chart')
const countEls = {
  up: document.getElementById('count-up'),
  redirect_up: document.getElementById('count-redirect_up'),
  redirect_down: document.getElementById('count-redirect_down'),
  unique_redirect: document.getElementById('count-unique_redirect'),
  cloudflare_block: document.getElementById('count-cloudflare_block'),
  down: document.getElementById('count-down')
}

const state = { up: [], redirect_up: [], redirect_down: [], unique_redirect: [], cloudflare_block: [], down: [], redirect: [] }

function toLines(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

function showNotification(message) {
  const notification = document.createElement('div')
  notification.className = 'notification'
  notification.textContent = message
  notificationContainer.appendChild(notification)
  setTimeout(() => notification.classList.add('show'), 10)
  setTimeout(() => {
    notification.classList.remove('show')
    setTimeout(() => notification.remove(), 300)
  }, 3000)
}

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function renderItem(r) {
  const li = document.createElement('li')
  li.className = 'result-item'

  // Add thumbnail class if screenshot exists
  if (r.screenshot) {
    li.classList.add('result-item-with-thumb')
  }

  const badgeClass = {
    up: 'badge badge-up',
    redirect_up: 'badge badge-redirect-up',
    redirect_down: 'badge badge-redirect-down',
    unique_redirect: 'badge badge-unique-redirect',
    redirect: 'badge badge-redirect-down',
    cloudflare_block: 'badge badge-cf',
    down: 'badge badge-down'
  }[r.category] || 'badge'

  const displayName = {
    up: 'Up',
    redirect_up: 'Redirect Up',
    redirect_down: 'Redirect Down',
    unique_redirect: 'Unique Redirect',
    redirect: 'Redirect (Unknown)',
    cloudflare_block: 'Cloudflare',
    down: 'Down'
  }[r.category] || r.category.replace('_', ' ')

  const right = document.createElement('div')
  right.innerHTML = `<span class="${badgeClass}">${displayName}</span>`

  // Build variations display if present
  let variationsHtml = ''
  if (r.variations && r.variations.length > 0) {
    const miniCategoryClass = {
      up: 'mini-badge-up',
      redirect_up: 'mini-badge-redirect-up',
      redirect_down: 'mini-badge-redirect-down',
      unique_redirect: 'mini-badge-unique-redirect',
      cloudflare_block: 'mini-badge-cf',
      down: 'mini-badge-down'
    }

    const variationBadges = r.variations.map(v => {
      const isHttps = v.url.startsWith('https://')
      const hasWww = v.url.includes('://www.')

      // Create distinct labels for all 4 combinations
      let label = ''
      if (isHttps && !hasWww) {
        label = 'https://'
      } else if (isHttps && hasWww) {
        label = 'https://www.'
      } else if (!isHttps && !hasWww) {
        label = 'http://'
      } else if (!isHttps && hasWww) {
        label = 'http://www.'
      }

      const miniClass = miniCategoryClass[v.category] || 'mini-badge-down'
      const title = `${v.url}\n${v.category} (HTTP ${v.httpStatus})\n${v.reason}`
      return `<a href="${v.url}" target="_blank" rel="noopener noreferrer" class="mini-badge ${miniClass}" title="${title}">${label}</a>`
    }).join('')

    variationsHtml = `<div class="variations">Tried: ${variationBadges}</div>`
  }

  // Add final destination badge if present
  let finalDestHtml = ''
  if (r.finalDestination) {
    finalDestHtml = `<div class="final-destination">
      <span class="final-label">Final →</span>
      <a href="${r.finalDestination}" target="_blank" rel="noopener noreferrer" class="final-badge" title="Ultimate destination after all redirects">${r.finalDestination}</a>
    </div>`
  }

  // Add thumbnail if screenshot exists
  if (r.screenshot) {
    const thumb = document.createElement('img')
    thumb.className = 'result-thumbnail'
    thumb.src = r.screenshot
    thumb.alt = 'Screenshot'
    thumb.title = 'Click to view full screenshot'
    thumb.onclick = () => {
      // Find the category and open gallery at this item
      const cat = r.category === 'redirect' ? 'redirect_down' : r.category
      const idx = screenshotData[cat]?.findIndex(s => s.url === r.url)
      if (idx >= 0) {
        currentGallery.category = cat
        currentGallery.index = idx
        const categoryNames = {
          up: 'Up', redirect_up: 'Redirect Up', redirect_down: 'Redirect Down',
          unique_redirect: 'Unique Redirect', cloudflare_block: 'Cloudflare', down: 'Down'
        }
        screenshotModalTitle.textContent = `${categoryNames[cat] || cat} Screenshots`
        updateScreenshotDisplay()
        screenshotModal.classList.add('show')
        document.body.style.overflow = 'hidden'
      }
    }
    li.appendChild(thumb)
  }

  const left = document.createElement('div')
  const displayUrl = r.baseUrl || r.url
  const linkUrl = r.url
  left.innerHTML = `
    <div class="url"><a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${displayUrl}</a></div>
    <div class="meta">HTTP ${r.httpStatus} • ${r.reason} • ${r.timeMs}ms
      ${r.redirectTo ? `<span class="redirect-target"> → <a href="${r.redirectTo}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; text-decoration-color: rgba(255, 193, 168, 0.3);">${r.redirectTo}</a>${r.redirectStatus ? ` (${r.redirectStatus})` : ''}</span>` : ''}
    </div>
    ${variationsHtml}
    ${finalDestHtml}
    ${r.scrapedText ? `<div class="scraped-text">"${r.scrapedText}..."</div>` : ''}
  `
  li.appendChild(left)
  li.appendChild(right)
  return li
}

function saveToLocalStorage(results) {
  try {
    localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(results))
    localStorage.setItem(STORAGE_KEYS.URLS, urlsEl.value)
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(state))
  } catch (e) {
    console.error('Failed to save to localStorage:', e)
  }
}

function loadFromLocalStorage() {
  try {
    const savedResults = localStorage.getItem(STORAGE_KEYS.RESULTS)
    const savedUrls = localStorage.getItem(STORAGE_KEYS.URLS)
    const savedState = localStorage.getItem(STORAGE_KEYS.STATE)
    
    if (savedUrls) {
      urlsEl.value = savedUrls
      if (enteredCountEl) enteredCountEl.textContent = toLines(savedUrls).length
    }
    
    if (savedResults) {
      const results = JSON.parse(savedResults)
      results.forEach(r => resultsEl.appendChild(renderItem(r)))
      if (checkedCountEl) checkedCountEl.textContent = `Checked: ${results.length}`
    }
    
    if (savedState) {
      const loadedState = JSON.parse(savedState)
      Object.keys(loadedState).forEach(k => {
        if (state[k]) state[k] = loadedState[k]
      })
      renderTables()
      renderChart()
    }
  } catch (e) {
    console.error('Failed to load from localStorage:', e)
  }
}

function clearAll() {
  // Clear localStorage
  localStorage.removeItem(STORAGE_KEYS.RESULTS)
  localStorage.removeItem(STORAGE_KEYS.URLS)
  localStorage.removeItem(STORAGE_KEYS.STATE)
  
  // Clear UI
  urlsEl.value = ''
  resultsEl.innerHTML = ''
  if (enteredCountEl) enteredCountEl.textContent = '0'
  if (checkedCountEl) checkedCountEl.textContent = ''
  
  // Clear state
  Object.keys(state).forEach(k => state[k] = [])
  renderTables()
  renderChart()
}

async function check() {
  let urls = toLines(urlsEl.value)
  if (urls.length === 0) return

  // Remove duplicates
  const uniqueUrls = [...new Set(urls)]
  const duplicatesRemoved = urls.length - uniqueUrls.length

  if (duplicatesRemoved > 0) {
    showNotification(`${duplicatesRemoved} duplicate URL${duplicatesRemoved > 1 ? 's' : ''} removed`)
    urls = uniqueUrls
    urlsEl.value = urls.join('\n')
    if (enteredCountEl) enteredCountEl.textContent = urls.length
  }

  // Show warning for 200+ sites
  warningContainer.innerHTML = ''
  if (urls.length >= 200) {
    const warning = document.createElement('div')
    warning.className = 'warning-message'
    warning.textContent = 'This may take a while if all filters are applied'
    warningContainer.appendChild(warning)
  }

  const startTime = Date.now()
  progressEl.style.display = 'flex'
  resultsEl.innerHTML = ''
  if (timeTakenEl) timeTakenEl.textContent = ''

  // Reset state
  Object.keys(state).forEach(k => state[k] = [])
  Object.keys(screenshotData).forEach(k => screenshotData[k] = [])
  screenshotsByUrl = {} // Reset URL-keyed screenshots

  const isAdvancedMode = advancedRedirectsEl && advancedRedirectsEl.checked
  const BATCH_SIZE = isAdvancedMode ? 1 : 5 // 1 at a time for Puppeteer, 5 for normal
  const totalUrls = urls.length
  const allResults = []
  const progressText = el('#progress-text')

  try {
    // Process in batches (1 for Puppeteer, 5 for normal mode)
    for (let i = 0; i < totalUrls; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE)
      const endIndex = Math.min(i + BATCH_SIZE, totalUrls)

      // Update progress text
      if (progressText) {
        if (isAdvancedMode) {
          progressText.textContent = `Puppeteer checking ${i + 1} / ${totalUrls}...`
        } else {
          progressText.textContent = `Checking ${i + 1}-${endIndex} / ${totalUrls}...`
        }
      }

      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: batch,
          allUrls: urls,
          tryAllVariations: tryAllVariationsEl ? tryAllVariationsEl.checked : false,
          checkRedirectsGeo: checkRedirectsGeoEl ? checkRedirectsGeoEl.checked : true,
          detectUniqueRedirects: detectUniqueRedirectsEl ? detectUniqueRedirectsEl.checked : false,
          advancedRedirects: isAdvancedMode,
          puppeteerScreenshot: puppeteerScreenshotEl ? puppeteerScreenshotEl.checked : false
        })
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('Server error:', errText)
        throw new Error(`Server error: ${res.status}`)
      }

      const data = await res.json()

      // Process batch results immediately
      data.results.forEach(r => {
        resultsEl.appendChild(renderItem(r))
        allResults.push(r)

        const cat = r.category === 'redirect' ? 'redirect_down' : r.category
        if (state[cat]) state[cat].push(r.url)

        // Collect screenshot data
        if (r.screenshot) {
          screenshotsByUrl[r.url] = r.screenshot // Store by URL for easy lookup
          if (screenshotData[cat]) {
            screenshotData[cat].push({ url: r.url, screenshot: r.screenshot })
          }
        }

        // Check if this result has a unique redirect
        if (r.isUniqueRedirect && (r.redirectTo || r.finalDestination)) {
          const uniqueUrl = r.finalDestination || r.redirectTo
          if (!state.unique_redirect.includes(uniqueUrl)) {
            state.unique_redirect.push(uniqueUrl)
          }
        }
      })

      // Update UI after each batch
      if (checkedCountEl) checkedCountEl.textContent = `Checked: ${allResults.length}`
      renderTables()
      updateScreenshotButtons()
      renderChart()
    }

    const timeTaken = Date.now() - startTime
    if (timeTakenEl) timeTakenEl.textContent = `Time: ${formatTime(timeTaken)}`

    // Clear warning after completion
    setTimeout(() => warningContainer.innerHTML = '', 500)

    // Save to localStorage
    saveToLocalStorage(allResults)
  } catch (e) {
    console.error('Fetch error:', e)
    const li = document.createElement('li')
    li.className = 'result-item'
    li.innerHTML = `<div style="color: #ef4444;">Error: ${e.message || 'Failed to connect to server'}</div><div style="color: var(--muted); font-size: 12px; margin-top: 4px;">Make sure the server is running (npm start)</div>`
    resultsEl.appendChild(li)
  } finally {
    progressEl.style.display = 'none'
  }
}

btn.addEventListener('click', check)
clearBtn.addEventListener('click', () => {
  clearAll()
})

urlsEl.addEventListener('input', () => {
  if (enteredCountEl) enteredCountEl.textContent = toLines(urlsEl.value).length
  // Auto-save URLs as user types
  try {
    localStorage.setItem(STORAGE_KEYS.URLS, urlsEl.value)
  } catch (e) {}
})

if (enteredCountEl) enteredCountEl.textContent = toLines(urlsEl.value).length

// Load saved data on page load
loadFromLocalStorage()

function renderTables() {
  const buildRows = (list, cat) => list.map(u => `<tr class=\"row\" draggable=\"true\" data-url=\"${u}\" data-cat=\"${cat}\"><td title=\"${u}\"><a href="${u}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; text-decoration-color: rgba(255, 255, 255, 0.15); text-underline-offset: 2px;">${u}</a></td></tr>`).join('')
  tbUp.innerHTML = buildRows(state.up, 'up')
  tbRedirectUp.innerHTML = buildRows(state.redirect_up, 'redirect_up')
  tbRedirectDown.innerHTML = buildRows(state.redirect_down, 'redirect_down')
  if (tbUniqueRedirect) {
    tbUniqueRedirect.innerHTML = buildRows(state.unique_redirect, 'unique_redirect')
  }
  tbCf.innerHTML = buildRows(state.cloudflare_block, 'cloudflare_block')
  tbDown.innerHTML = buildRows(state.down, 'down')

  // Mark empty boxes so they are visually droppable
  tableBoxes.forEach(box => {
    const cat = box.getAttribute('data-category')
    const list = state[cat] || []
    box.classList.toggle('empty', list.length === 0)
  })
  updateCounts()
}

function moveUrl(url, from, to) {
  if (!state[from] || !state[to]) return
  const idx = state[from].indexOf(url)
  if (idx > -1) state[from].splice(idx, 1)
  if (!state[to].includes(url)) state[to].push(url)

  // Also move screenshot if exists
  if (screenshotsByUrl[url]) {
    // Remove from old category
    if (screenshotData[from]) {
      const ssIdx = screenshotData[from].findIndex(s => s.url === url)
      if (ssIdx > -1) screenshotData[from].splice(ssIdx, 1)
    }
    // Add to new category
    if (screenshotData[to]) {
      const exists = screenshotData[to].some(s => s.url === url)
      if (!exists) {
        screenshotData[to].push({ url, screenshot: screenshotsByUrl[url] })
      }
    }
  }
}

document.addEventListener('dragstart', e => {
  const row = e.target.closest('tr.row')
  if (!row) return
  row.classList.add('dragging')
  const url = row.getAttribute('data-url')
  const from = row.getAttribute('data-cat')
  e.dataTransfer.setData('text/plain', JSON.stringify({ url, from }))
})

document.addEventListener('dragend', e => {
  const row = e.target.closest('tr.row')
  if (row) row.classList.remove('dragging')
})

tableBoxes.forEach(box => {
  const tbody = box.querySelector('tbody')
  tbody.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('dropping') })
  tbody.addEventListener('dragleave', () => { box.classList.remove('dropping') })
  tbody.addEventListener('drop', e => {
    e.preventDefault()
    box.classList.remove('dropping')
    const data = e.dataTransfer.getData('text/plain')
    if (!data) return
    let parsed
    try { parsed = JSON.parse(data) } catch { return }
    const to = box.getAttribute('data-category')
    if (parsed.url && parsed.from && to && parsed.from !== to) {
      moveUrl(parsed.url, parsed.from, to)
      renderTables()
      updateScreenshotButtons()
      renderChart()
    }
  })

  // Allow drop over the entire box (including header), useful when tbody has no rows
  box.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; box.classList.add('dropping') })
  box.addEventListener('dragleave', () => { box.classList.remove('dropping') })
  box.addEventListener('drop', e => {
    e.preventDefault()
    box.classList.remove('dropping')
    const data = e.dataTransfer.getData('text/plain')
    if (!data) return
    let parsed
    try { parsed = JSON.parse(data) } catch { return }
    const to = box.getAttribute('data-category')
    if (parsed.url && parsed.from && to && parsed.from !== to) {
      moveUrl(parsed.url, parsed.from, to)
      renderTables()
      updateScreenshotButtons()
      renderChart()
    }
  })
})

copyBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    const cat = btn.getAttribute('data-target')
    const list = state[cat] || []
    try {
      await navigator.clipboard.writeText(list.join('\n'))
      const old = btn.textContent
      btn.textContent = 'Copied!'
      setTimeout(() => { btn.textContent = old }, 1200)
    } catch (_) {}
  })
})

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function updateCounts() {
  Object.keys(countEls).forEach(k => {
    if (countEls[k]) countEls[k].textContent = (state[k] || []).length
  })
}

function renderChart() {
  if (!chartCanvas) return
  const dpr = window.devicePixelRatio || 1
  const size = Math.min(chartCanvas.clientWidth, chartCanvas.clientHeight)
  chartCanvas.width = size * dpr
  chartCanvas.height = size * dpr
  const ctx = chartCanvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const vals = [
    state.up.length, 
    state.redirect_up.length, 
    state.redirect_down.length,
    state.unique_redirect.length,
    state.cloudflare_block.length,
    state.down.length
  ]
  const total = vals.reduce((a,b) => a+b, 0)
  const colors = [
    getCssVar('--up'), 
    getCssVar('--redirect-up'), 
    getCssVar('--redirect-down'),
    getCssVar('--unique-redirect'),
    getCssVar('--cf'),
    getCssVar('--down')
  ]
  ctx.clearRect(0,0,size,size)
  const cx = size/2, cy = size/2, r = size/2 - 12
  
  // background ring
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI*2)
  ctx.fillStyle = '#0c0c0d'
  ctx.fill()
  if (total === 0) {
    ctx.fillStyle = '#888'
    ctx.font = '14px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('No data', cx, cy+5)
    return
  }
  let start = -Math.PI/2
  for (let i=0;i<vals.length;i++) {
    const frac = vals[i]/total
    if (frac <= 0) continue
    const end = start + frac * Math.PI*2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, start, end)
    ctx.closePath()
    ctx.fillStyle = colors[i] || '#999'
    ctx.fill()
    start = end
  }
  // inner cut for donut
  ctx.beginPath()
  ctx.arc(cx, cy, r*0.60, 0, Math.PI*2)
  ctx.fillStyle = '#0c0c0d'
  ctx.fill()
  // center total
  ctx.fillStyle = '#ddd'
  ctx.font = 'bold 16px Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(total.toString(), cx, cy+6)
}

window.addEventListener('resize', () => { renderChart() })

// Screenshot Gallery Functions
function updateScreenshotButtons() {
  const screenshotBtns = document.querySelectorAll('.screenshot-btn')
  screenshotBtns.forEach(btn => {
    const cat = btn.getAttribute('data-target')
    const hasScreenshots = screenshotData[cat] && screenshotData[cat].length > 0
    btn.style.display = hasScreenshots ? 'inline-block' : 'none'
  })
}

function openScreenshotGallery(category) {
  const screenshots = screenshotData[category]
  if (!screenshots || screenshots.length === 0) return

  currentGallery.category = category
  currentGallery.index = 0

  const categoryNames = {
    up: 'Up',
    redirect_up: 'Redirect Up',
    redirect_down: 'Redirect Down',
    unique_redirect: 'Unique Redirect',
    cloudflare_block: 'Cloudflare',
    down: 'Down'
  }

  screenshotModalTitle.textContent = `${categoryNames[category] || category} Screenshots`
  updateScreenshotDisplay()
  screenshotModal.classList.add('show')
  document.body.style.overflow = 'hidden'
}

function closeScreenshotGallery() {
  screenshotModal.classList.remove('show')
  document.body.style.overflow = ''
}

function updateScreenshotDisplay() {
  const screenshots = screenshotData[currentGallery.category]
  if (!screenshots || screenshots.length === 0) return

  const current = screenshots[currentGallery.index]
  screenshotImage.src = current.screenshot
  screenshotUrl.textContent = current.url
  screenshotCounter.textContent = `${currentGallery.index + 1} / ${screenshots.length}`

  // Update navigation button states
  screenshotPrev.disabled = currentGallery.index === 0
  screenshotNext.disabled = currentGallery.index === screenshots.length - 1
}

function navigateScreenshot(direction) {
  const screenshots = screenshotData[currentGallery.category]
  if (!screenshots) return

  const newIndex = currentGallery.index + direction
  if (newIndex >= 0 && newIndex < screenshots.length) {
    currentGallery.index = newIndex
    updateScreenshotDisplay()
  }
}

// Screenshot button click handlers
document.querySelectorAll('.screenshot-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const category = btn.getAttribute('data-target')
    openScreenshotGallery(category)
  })
})

// Screenshot modal navigation
if (screenshotPrev) screenshotPrev.addEventListener('click', () => navigateScreenshot(-1))
if (screenshotNext) screenshotNext.addEventListener('click', () => navigateScreenshot(1))
if (screenshotModalClose) screenshotModalClose.addEventListener('click', closeScreenshotGallery)
if (screenshotModalOverlay) screenshotModalOverlay.addEventListener('click', closeScreenshotGallery)

// Keyboard navigation for screenshot gallery
document.addEventListener('keydown', (e) => {
  if (screenshotModal && screenshotModal.classList.contains('show')) {
    if (e.key === 'Escape') closeScreenshotGallery()
    if (e.key === 'ArrowLeft') navigateScreenshot(-1)
    if (e.key === 'ArrowRight') navigateScreenshot(1)
    if (e.key === 'd' || e.key === 'D') moveCurrentScreenshotToDown()
  }
})

// Quick "Move to Down" button handler
function moveCurrentScreenshotToDown() {
  const screenshots = screenshotData[currentGallery.category]
  if (!screenshots || screenshots.length === 0) return
  const current = screenshots[currentGallery.index]
  if (!current) return
  if (currentGallery.category === 'down') {
    showNotification('Already in Down')
    return
  }

  const url = current.url
  moveUrl(url, currentGallery.category, 'down')
  renderTables()
  updateScreenshotButtons()
  renderChart()

  // After moving, check if there are screenshots left in this category
  const remaining = screenshotData[currentGallery.category]
  if (!remaining || remaining.length === 0) {
    closeScreenshotGallery()
    showNotification('Moved to Down')
    return
  }
  // Stay on same index or go to last
  if (currentGallery.index >= remaining.length) {
    currentGallery.index = remaining.length - 1
  }
  updateScreenshotDisplay()
  showNotification('Moved to Down')
}

const screenshotDownLeft = el('#screenshotDownLeft')
const screenshotDownRight = el('#screenshotDownRight')
if (screenshotDownLeft) screenshotDownLeft.addEventListener('click', moveCurrentScreenshotToDown)
if (screenshotDownRight) screenshotDownRight.addEventListener('click', moveCurrentScreenshotToDown)

// Send to button handler
if (screenshotSendBtn) {
  screenshotSendBtn.addEventListener('click', () => {
    const targetCategory = screenshotSendTo?.value
    if (!targetCategory) {
      showNotification('Please select a category')
      return
    }

    const screenshots = screenshotData[currentGallery.category]
    if (!screenshots || screenshots.length === 0) return

    const current = screenshots[currentGallery.index]
    if (!current) return

    const url = current.url
    const fromCategory = currentGallery.category

    // Don't move to same category
    if (fromCategory === targetCategory) {
      showNotification('Already in this category')
      return
    }

    // Move the URL (screenshot will follow automatically)
    moveUrl(url, fromCategory, targetCategory)

    // Update tables and chart
    renderTables()
    updateScreenshotButtons()
    renderChart()

    // Adjust gallery index if needed
    const newScreenshots = screenshotData[currentGallery.category]
    if (!newScreenshots || newScreenshots.length === 0) {
      closeScreenshotGallery()
      showNotification(`Moved to ${targetCategory.replace('_', ' ')}`)
      return
    }

    // Stay on same index or go to last item
    if (currentGallery.index >= newScreenshots.length) {
      currentGallery.index = newScreenshots.length - 1
    }

    updateScreenshotDisplay()
    screenshotSendTo.value = '' // Reset dropdown
    showNotification(`Moved to ${targetCategory.replace('_', ' ')}`)
  })
}

