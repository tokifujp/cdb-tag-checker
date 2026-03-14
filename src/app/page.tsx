'use client'

import { useState, useEffect } from 'react'
import type { DiagnosticResult } from './api/check/route'
import styles from './page.module.css'

type Status = 'idle' | 'loading' | 'done' | 'error'
type AuthStatus = 'checking' | 'login' | 'authenticated'

function buildMarkdown(result: DiagnosticResult): string {
  const lines: string[] = []
  const { tracker, gtm, ga4, cvTags, errors, consoleErrors } = result

  lines.push(`# 計測タグChecker 診断レポート`)
  lines.push(``)
  lines.push(`- **URL**: ${result.url}`)
  lines.push(`- **診断日時**: ${new Date(result.trackedAt).toLocaleString('ja-JP')}`)
  lines.push(``)

  lines.push(`## tracker.js（計測タグ）`)
  lines.push(``)
  lines.push(`| 項目 | 値 |`)
  lines.push(`|------|-----|`)
  lines.push(`| ステータス | ${tracker.found ? '✅ 検出' : '❌ 未検出'} |`)
  if (tracker.found) {
    if (tracker.env) lines.push(`| 環境 | ${tracker.env} |`)
    const via = tracker.via.length === 0 ? '不明' : tracker.via.map((v) => v === 'gtm' ? 'GTM経由' : '直接設置').join(' + ')
    lines.push(`| 設置方法 | ${via} |`)
    lines.push(`| キャンペーンID | ${tracker.campaignId ?? '⚠ 未設定'} |`)
    lines.push(`| 置換対象電話番号 | ${tracker.phoneNumbers.length > 0 ? tracker.phoneNumbers.join(', ') : '⚠ 未設定'} |`)
    lines.push(`| LINE友だち追加計測 | ${tracker.lineFriendAdd.found ? '✅ あり' : '— なし'} |`)
    if (tracker.lineFriendAdd.found) {
      lines.push(`| 対象セレクタ | \`${(tracker.lineFriendAdd.selector ?? '').replace(/\|/g, '\\|')}\` |`)
      const elStatus = tracker.lineFriendAdd.elementExists === null ? '— 未確認' : tracker.lineFriendAdd.elementExists ? '✅ 要素あり' : '❌ 要素なし'
      lines.push(`| 要素の存在確認 | ${elStatus} |`)
    }
  }
  lines.push(``)

  lines.push(`## Google Tag Manager`)
  lines.push(``)
  lines.push(`| 項目 | 値 |`)
  lines.push(`|------|-----|`)
  lines.push(`| ステータス | ${gtm.found ? '✅ 検出' : '— 未検出'} |`)
  if (gtm.found) lines.push(`| コンテナID | ${gtm.ids.join(', ')} |`)
  lines.push(``)

  lines.push(`## Google Analytics 4`)
  lines.push(``)
  lines.push(`| 項目 | 値 |`)
  lines.push(`|------|-----|`)
  lines.push(`| ステータス | ${ga4.found ? '✅ 検出' : '— 未検出'} |`)
  if (ga4.found) lines.push(`| 測定ID | ${ga4.ids.join(', ')} |`)
  lines.push(``)

  if (cvTags.google.found || cvTags.yahoo.found) {
    lines.push(`## CV送信タグ（Google / Yahoo!）`)
    lines.push(``)
    lines.push(`| 項目 | 値 |`)
    lines.push(`|------|-----|`)
    if (cvTags.google.found) {
      lines.push(`| Google CV送信タグ | ✅ 検出 |`)
      lines.push(`| 引数のtel:有無 | ${cvTags.google.hasTelInArgs ? '❌ tel: あり（要修正）' : '✅ 問題なし'} |`)
    }
    if (cvTags.yahoo.found) {
      lines.push(`| Yahoo! CV送信タグ | ✅ 検出 |`)
      lines.push(`| 引数のtel:有無 | ${cvTags.yahoo.hasTelInArgs ? '❌ tel: あり（要修正）' : '✅ 問題なし'} |`)
    }
    lines.push(``)
  }

  if (consoleErrors.length > 0) {
    lines.push(`## コンソールエラーログ`)
    lines.push(``)
    consoleErrors.forEach((e, i) => lines.push(`${i + 1}. ${e}`))
    lines.push(``)
  }

  if (errors.length > 0) {
    lines.push(`## エラーログ`)
    lines.push(``)
    errors.forEach((e, i) => lines.push(`${i + 1}. ${e}`))
    lines.push(``)
  }

  return lines.join('\n')
}

export default function Home() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [userLabel, setUserLabel] = useState('')
  const [oem, setOem] = useState('cdb')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [apiError, setApiError] = useState('')
  const [copied, setCopied] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  // 初回認証チェック
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setUserLabel(data.label)
          setAuthStatus('authenticated')
        } else {
          setAuthStatus('login')
        }
      })
      .catch(() => setAuthStatus('login'))
  }, [])

  const handleLogin = async () => {
    setLoginLoading(true)
    setLoginError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oem, email, password }),
    })
    const data = await res.json()
    setLoginLoading(false)
    if (data.ok) {
      setUserLabel(data.label)
      setAuthStatus('authenticated')
    } else {
      setLoginError(data.error || 'ログインに失敗しました')
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthStatus('login')
    setResult(null)
    setStatus('idle')
    setOem('cdb')
    setEmail('')
    setPassword('')
  }

  const handleCheck = async () => {
    if (!url.trim()) return
    setStatus('loading')
    setResult(null)
    setApiError('')
    setCopied(false)
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    })
    const data = await res.json()
    if (!res.ok) {
      if (res.status === 401) {
        setAuthStatus('login')
        return
      }
      setApiError(data.error || 'エラーが発生しました')
      setStatus('error')
      return
    }
    setResult(data)
    setStatus('done')
  }

  const handleCopy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(buildMarkdown(result))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (authStatus === 'checking') {
    return (
      <main className={styles.main}>
        <div className={styles.centerMsg}>
          <span className={styles.spinner} style={{ borderColor: 'rgba(0,229,160,0.2)', borderTopColor: 'var(--accent)' }} />
        </div>
      </main>
    )
  }

  if (authStatus === 'login') {
    return (
      <main className={styles.main}>
        <div className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>◈</span>
            <span>計測タグChecker</span>
          </div>
          <p className={styles.sub}>Call Data Bank 計測タグ診断ツール</p>
        </div>

        <div className={styles.loginBox}>
          <p className={styles.loginTitle}>アカウントでログイン</p>
          <div className={styles.loginField}>
            <label className={styles.loginLabel}>環境</label>
            <select className={styles.loginInput} value={oem} onChange={(e) => setOem(e.target.value)}>
              <option value="cdb">コールデータバンク</option>
              <option value="adsip">AdSiP</option>
              <option value="ivry">IVRy</option>
            </select>
          </div>
          <div className={styles.loginField}>
            <label className={styles.loginLabel}>メールアドレス</label>
            <input className={styles.loginInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
          </div>
          <div className={styles.loginField}>
            <label className={styles.loginLabel}>パスワード</label>
            <input className={styles.loginInput} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
          </div>
          {loginError && <p className={styles.errorMsg}>{loginError}</p>}
          <button className={styles.loginBtn} onClick={handleLogin} disabled={loginLoading || !oem || !email || !password}>
            {loginLoading ? <span className={styles.spinner} /> : 'ログイン'}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>◈</span>
          <span>計測タグChecker</span>
        </div>
        <div className={styles.headerRight}>
          <p className={styles.sub}>Call Data Bank 計測タグ診断ツール</p>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{userLabel}</span>
            <button className={styles.logoutBtn} onClick={handleLogout}>ログアウト</button>
          </div>
        </div>
      </div>

      <div className={styles.inputSection}>
        <div className={styles.inputWrap}>
          <span className={styles.inputPrefix}>URL</span>
          <input
            className={styles.input}
            type="url"
            placeholder="https://example.com/lp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
          />
          <button className={styles.btn} onClick={handleCheck} disabled={status === 'loading' || !url.trim()}>
            {status === 'loading' ? <span className={styles.spinner} /> : '診断する'}
          </button>
        </div>
        {status === 'loading' && <p className={styles.loadingMsg}>ページを解析中です。10〜20秒ほどかかります...</p>}
        {status === 'error' && <p className={styles.errorMsg}>⚠ {apiError}</p>}
      </div>

      {result && (
        <div className={styles.results}>
          <Section title="tracker.js（計測タグ）" status={result.tracker.found ? 'ok' : 'ng'}>
            <Row label="ステータス" value={result.tracker.found ? '✅ 検出' : '❌ 未検出'} highlight={result.tracker.found} error={!result.tracker.found} />
            {result.tracker.found && (
              <>
                {result.tracker.env && <Row label="環境" value={result.tracker.env} highlight />}
                <Row label="設置方法" value={result.tracker.via.length === 0 ? '不明' : result.tracker.via.map((v) => v === 'gtm' ? '📦 GTM経由' : '📄 直接設置').join(' + ')} />
                <Row label="キャンペーンID" value={result.tracker.campaignId ?? '⚠ 未設定'} warn={!result.tracker.campaignId} mono />
                <Row label="置換対象電話番号" value={result.tracker.phoneNumbers.length > 0 ? result.tracker.phoneNumbers.join(' / ') : '⚠ 未設定'} warn={result.tracker.phoneNumbers.length === 0} mono />
                <Row label="LINE友だち追加計測" value={result.tracker.lineFriendAdd.found ? '✅ あり' : '— なし'} />
                {result.tracker.lineFriendAdd.found && (
                  <>
                    <Row label="対象セレクタ" value={result.tracker.lineFriendAdd.selector ?? ''} mono />
                    <Row
                      label="要素の存在確認"
                      value={result.tracker.lineFriendAdd.elementExists === null ? '— 未確認' : result.tracker.lineFriendAdd.elementExists ? '✅ 要素あり' : '❌ 要素なし'}
                      highlight={result.tracker.lineFriendAdd.elementExists === true}
                      error={result.tracker.lineFriendAdd.elementExists === false}
                    />
                  </>
                )}
              </>
            )}
          </Section>

          <Section title="Google Tag Manager" status={result.gtm.found ? 'ok' : 'warn'}>
            <Row label="ステータス" value={result.gtm.found ? '✅ 検出' : '— 未検出'} highlight={result.gtm.found} />
            {result.gtm.found && <Row label="コンテナID" value={result.gtm.ids.join(', ')} mono />}
          </Section>

          <Section title="Google Analytics 4" status={result.ga4.found ? 'ok' : 'warn'}>
            <Row label="ステータス" value={result.ga4.found ? '✅ 検出' : '— 未検出'} highlight={result.ga4.found} />
            {result.ga4.found && <Row label="測定ID" value={result.ga4.ids.join(', ')} mono />}
          </Section>

          {(result.cvTags.google.found || result.cvTags.yahoo.found) && (() => {
            const g = result.cvTags.google
            const y = result.cvTags.yahoo
            const hasIssue = g.hasTelInArgs || y.hasTelInArgs
            return (
              <Section title="CV送信タグ（Google / Yahoo!）" status={hasIssue ? 'ng' : 'ok'}>
                {g.found && (
                  <>
                    <Row label="Google CV送信タグ" value="✅ 検出" highlight />
                    <Row
                      label="引数のtel:有無"
                      value={g.hasTelInArgs ? '❌ tel: あり（要修正）' : '✅ 問題なし'}
                      error={g.hasTelInArgs}
                      highlight={!g.hasTelInArgs}
                    />
                    {g.hasTelInArgs && g.occurrences.map((o, i) => (
                      <Row key={i} label={`該当箇所[${i + 1}]`} value={o} warn mono />
                    ))}
                  </>
                )}
                {y.found && (
                  <>
                    <Row label="Yahoo! CV送信タグ" value="✅ 検出" highlight />
                    <Row
                      label="引数のtel:有無"
                      value={y.hasTelInArgs ? '❌ tel: あり（要修正）' : '✅ 問題なし'}
                      error={y.hasTelInArgs}
                      highlight={!y.hasTelInArgs}
                    />
                    {y.hasTelInArgs && y.occurrences.map((o, i) => (
                      <Row key={i} label={`該当箇所[${i + 1}]`} value={o} warn mono />
                    ))}
                  </>
                )}
                {hasIssue && (
                  <Row
                    label="修正方法"
                    value={'goog_report_conversion(undefined) / yahoo_report_conversion(undefined) に変更してください'}
                    warn
                  />
                )}
              </Section>
            )
          })()}

          {result.consoleErrors.length > 0 && (
            <Section title="コンソールエラーログ" status="warn">
              {result.consoleErrors.map((e, i) => <Row key={i} label={`[${i + 1}]`} value={e} warn />)}
            </Section>
          )}

          {result.errors.length > 0 && (
            <Section title="エラーログ" status="warn">
              {result.errors.map((e, i) => <Row key={i} label={`[${i + 1}]`} value={e} warn />)}
            </Section>
          )}

          <div className={styles.footer}>
            <p className={styles.timestamp}>診断日時: {new Date(result.trackedAt).toLocaleString('ja-JP')}</p>
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? '✅ コピーしました' : '📋 Markdownでコピー'}
            </button>
          </div>
        </div>
      )}

      <footer className={styles.legalFooter}>
        <ul className={styles.legalNav}>
          <li>
            <button className={styles.legalTrigger} onClick={() => setModalOpen(true)}>
              計測タグCheckerについて
            </button>
          </li>
          <li className={styles.legalNavDivider}>|</li>
          <li>
            <p className={styles.legalPowered}>
              Powered by <a className={styles.legalLink} href="https://tokifu.jp/" target="_blank" rel="noopener noreferrer"><span className={styles.legalAccent}>tokifujp</span></a>
            </p>
          </li>
          <li>
            <a className={styles.githubLink} href="https://github.com/tokifujp/cdb-tag-checker" target="_blank" rel="noopener noreferrer" aria-label="GitHub Repository">
              <svg className={styles.githubIcon} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
          </li>
        </ul>
      </footer>

      {modalOpen && (
        <div className={styles.modalOverlay} onClick={() => setModalOpen(false)}>
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>計測タグCheckerについて</h2>
              <button className={styles.modalClose} onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <ul className={styles.legalList}>
              <li><a className={styles.legalLink} href="https://call.omnidatabank.jp/?utm_source=tag_checker" target="_blank" rel="noopener noreferrer">Call Data Bank</a> は<a className={styles.legalLink} href="https://lograph.co.jp/" target="_blank" rel="noopener noreferrer">株式会社ログラフ</a>の登録商標です。</li>
              <li>本ツールは診断対象サイトの情報を保存せず、第三者への提供も一切行いません。</li>
              <li>本ツールの利用により生じたいかなる損害についても、提供者は責任を負いかねます。</li>
            </ul>
          </div>
        </div>
      )}
    </main>
  )
}

function Section({ title, status, children }: { title: string; status: 'ok' | 'warn' | 'ng'; children: React.ReactNode }) {
  const dot = status === 'ok' ? styles.dotOk : status === 'warn' ? styles.dotWarn : styles.dotNg
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={`${styles.dot} ${dot}`} />
        <h2 className={styles.sectionTitle}>{title}</h2>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  )
}

function Row({ label, value, highlight, warn, error, mono }: { label: string; value: string; highlight?: boolean; warn?: boolean; error?: boolean; mono?: boolean }) {
  const valueClass = [styles.rowValue, highlight ? styles.valueHighlight : '', warn ? styles.valueWarn : '', error ? styles.valueError : '', mono ? styles.valueMono : ''].filter(Boolean).join(' ')
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}
