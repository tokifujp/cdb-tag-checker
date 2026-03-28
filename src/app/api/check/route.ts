import { NextRequest, NextResponse } from 'next/server'
import puppeteer from 'puppeteer'
import { lookup } from 'dns/promises'

// 環境定義（タグホストから自動判別）
const TRACKER_HOSTS: { host: string; env: string }[] = [
  { host: 'assets.omni-databank.com',    env: 'コールデータバンク' },
  { host: 'assets.adsip.net',            env: 'AdSiP' },
  { host: 'assets-ivry.omni-databank.com', env: 'IVRy' },
]

export interface DiagnosticResult {
  url: string
  trackedAt: string
  tracker: {
    env: string | null
    found: boolean
    via: ('direct' | 'gtm')[]
    campaignId: string | null
    phoneNumbers: string[]
    lineFriendAdd: {
      found: boolean
      selector: string | null
      elementExists: boolean | null
    }
  }
  gtm: {
    found: boolean
    ids: string[]
  }
  ga4: {
    found: boolean
    ids: string[]
  }
  cvTags: {
    google: { found: boolean; hasTelInArgs: boolean; occurrences: string[] }
    yahoo: { found: boolean; hasTelInArgs: boolean; occurrences: string[] }
  }
  consoleErrors: string[]
  errors: string[]
}

function isPrivateIP(ip: string): boolean {
  const privateRanges = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
    /^0\.0\.0\.0$/,
  ]
  return privateRanges.some((r) => r.test(ip))
}

async function validateUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return '有効なURLを入力してください'
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return '有効なURLを入力してください'
  }
  const hostname = parsed.hostname
  // ローカルホスト名を直接ブロック
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
    return 'このURLは診断できません'
  }
  // DNS解決してIPアドレスを確認
  try {
    const addresses = await lookup(hostname, { all: true })
    for (const addr of addresses) {
      if (isPrivateIP(addr.address)) {
        return 'このURLは診断できません'
      }
    }
  } catch {
    return 'ホスト名を解決できませんでした'
  }
  return null
}

export async function POST(req: NextRequest) {
  // 認証チェック
  const token = req.cookies.get('cdb_token')?.value
  if (!token) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  }

  const { url } = await req.json()

  const urlError = await validateUrl(url ?? '')
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 })
  }

  const result: DiagnosticResult = {
    url,
    trackedAt: new Date().toISOString(),
    tracker: {
      env: null,
      found: false,
      via: [],
      campaignId: null,
      phoneNumbers: [],
      lineFriendAdd: {
        found: false,
        selector: null,
        elementExists: null,
      },
    },
    gtm: { found: false, ids: [] },
    ga4: { found: false, ids: [] },
    cvTags: {
      google: { found: false, hasTelInArgs: false, occurrences: [] },
      yahoo: { found: false, hasTelInArgs: false, occurrences: [] },
    },
    consoleErrors: [],
    errors: [],
  }

  let browser
  try {
    // JS実行前の生HTMLを取得（direct/gtm判定用）
    let rawHtml = ''
    try {
      const rawRes = await fetch(url)
      rawHtml = await rawRes.text()
    } catch {
      result.errors.push('生HTMLの取得に失敗しました')
    }

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })

    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    )

    // コンソールエラーを収集
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        result.consoleErrors.push(msg.text())
      }
    })
    page.on('pageerror', (err: unknown) => {
      result.consoleErrors.push(err instanceof Error ? err.message : String(err))
    })

    // tracker.jsのリクエストを監視
    const loadedScripts: string[] = []
    page.on('request', (req) => {
      if (req.resourceType() === 'script') {
        loadedScripts.push(req.url())
      }
    })

    // odb()の呼び出しを収集するため、window.odbをフックする
    await page.evaluateOnNewDocument(() => {
      ;(window as any).__odbCalls = []
      ;(window as any).odb = new Proxy(function () {}, {
        apply(_target, _thisArg, args) {
          ;(window as any).__odbCalls.push(args)
        },
      })
    })

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })
    } catch {
      result.errors.push('ページの読み込みがタイムアウトしました（部分的な結果です）')
    }

    // --- tracker.js の検出（全環境対応）---
    let detectedHost: { host: string; env: string } | null = null
    for (const h of TRACKER_HOSTS) {
      if (loadedScripts.some((s) => s.includes(h.host))) {
        detectedHost = h
        break
      }
    }

    if (detectedHost) {
      result.tracker.found = true
      result.tracker.env = detectedHost.env

      // JS実行前の生HTMLで判定
      const escapedHost = detectedHost.host.replace(/\./g, '\\.')
      const directPattern = new RegExp(escapedHost + '\/tracker\.js')
      const gtmPattern = /googletagmanager\.com\/gtm\.js/
      if (directPattern.test(rawHtml)) result.tracker.via.push('direct')
      if (gtmPattern.test(rawHtml)) result.tracker.via.push('gtm')
    }

    // --- odb() 呼び出しの解析 ---
    const odbCalls: any[][] = await page.evaluate(() => (window as any).__odbCalls || [])

    for (const call of odbCalls) {
      const method = call[0]

      if (method === 'start') {
        result.tracker.found = true
        result.tracker.campaignId = String(call[1] ?? '')
      }

      if (method === 'phone.trackingNumber') {
        const tel = call[1]
        if (tel && !result.tracker.phoneNumbers.includes(tel)) {
          result.tracker.phoneNumbers.push(tel)
        }
      }

      if (method === 'line.friendadd') {
        const selector = call[1] as string // 例: ".lineAddFriend"
        result.tracker.lineFriendAdd.found = true
        result.tracker.lineFriendAdd.selector = selector

        // セレクタに対応するHTML要素が存在するか確認
        if (selector) {
          const elementExists = await page.evaluate((sel: string) => {
            return document.querySelector(sel) !== null
          }, selector)
          result.tracker.lineFriendAdd.elementExists = elementExists

          if (!elementExists) {
            result.errors.push(`LineAddFriendElement not found. (selector: ${selector})`)
          }
        }
      }
    }

    // --- GTM の検出 ---
    const gtmMatches = rawHtml.match(/GTM-[A-Z0-9]+/g)
    if (gtmMatches) {
      result.gtm.found = true
      result.gtm.ids = [...new Set(gtmMatches)]
    }

    // --- GA4 の検出 ---
    const ga4Matches = (await page.content()).match(/G-[A-Z0-9]{10}/g)
    if (ga4Matches) {
      result.ga4.found = true
      result.ga4.ids = [...new Set(ga4Matches)]
    }

    // --- CV送信タグの検出 ---
    const cvTagResult = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll('[onclick]'))
      const google = { found: false, hasTelInArgs: false, occurrences: [] as string[] }
      const yahoo = { found: false, hasTelInArgs: false, occurrences: [] as string[] }

      for (const el of allElements) {
        const onclick = el.getAttribute('onclick') || ''

        // goog_report_conversion
        const googMatch = onclick.match(/goog_report_conversion\s*\(([^)]*)\)/)
        if (googMatch) {
          google.found = true
          const arg = googMatch[1].trim()
          const hasTel = /tel:/i.test(arg)
          if (hasTel) google.hasTelInArgs = true
          google.occurrences.push(onclick.trim())
        }

        // yahoo_report_conversion
        const yahooMatch = onclick.match(/yahoo_report_conversion\s*\(([^)]*)\)/)
        if (yahooMatch) {
          yahoo.found = true
          const arg = yahooMatch[1].trim()
          const hasTel = /tel:/i.test(arg)
          if (hasTel) yahoo.hasTelInArgs = true
          yahoo.occurrences.push(onclick.trim())
        }
      }

      return { google, yahoo }
    })
    result.cvTags = cvTagResult
  } catch (err: any) {
    console.error('[check] unexpected error:', err)
    result.errors.push('診断中にエラーが発生しました')
  } finally {
    if (browser) await browser.close()
  }

  return NextResponse.json(result)
}
