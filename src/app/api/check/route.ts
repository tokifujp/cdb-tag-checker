import { NextRequest, NextResponse } from 'next/server'
import puppeteer from 'puppeteer'

export interface DiagnosticResult {
  url: string
  trackedAt: string
  tracker: {
    found: boolean
    via: 'direct' | 'gtm' | 'unknown'
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
  consoleErrors: string[]
  errors: string[]
}

export async function POST(req: NextRequest) {
  const { url } = await req.json()

  if (!url || !/^https?:\/\/.+/.test(url)) {
    return NextResponse.json({ error: '有効なURLを入力してください' }, { status: 400 })
  }

  const result: DiagnosticResult = {
    url,
    trackedAt: new Date().toISOString(),
    tracker: {
      found: false,
      via: 'unknown',
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

    // --- tracker.js の検出 ---
    const trackerUrl = 'assets.omni-databank.com/tracker.js'
    const trackerScript = loadedScripts.find((s) => s.includes(trackerUrl))

    if (trackerScript) {
      result.tracker.found = true

      // JS実行前の生HTMLで判定：直接書かれていれば direct、なければ GTM経由
      const directPattern = /assets\.omni-databank\.com\/tracker\.js/
      const gtmPattern = /googletagmanager\.com\/gtm\.js/
      if (directPattern.test(rawHtml)) {
        result.tracker.via = 'direct'
      } else if (gtmPattern.test(rawHtml)) {
        result.tracker.via = 'gtm'
      } else {
        result.tracker.via = 'unknown'
      }
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
  } catch (err: any) {
    result.errors.push(err.message ?? '不明なエラーが発生しました')
  } finally {
    if (browser) await browser.close()
  }

  return NextResponse.json(result)
}
