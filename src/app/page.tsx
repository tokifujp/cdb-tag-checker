'use client'

import { useState } from 'react'
import type { DiagnosticResult } from './api/check/route'
import styles from './page.module.css'

type Status = 'idle' | 'loading' | 'done' | 'error'

function buildMarkdown(result: DiagnosticResult): string {
  const lines: string[] = []
  const { tracker, gtm, ga4, errors } = result

  lines.push(`# Tag Checker 診断レポート`)
  lines.push(``)
  lines.push(`- **URL**: ${result.url}`)
  lines.push(`- **診断日時**: ${new Date(result.trackedAt).toLocaleString('ja-JP')}`)
  lines.push(``)

  // tracker.js
  lines.push(`## tracker.js（計測タグ）`)
  lines.push(``)
  lines.push(`| 項目 | 値 |`)
  lines.push(`|------|-----|`)
  lines.push(`| ステータス | ${tracker.found ? '✅ 検出' : '❌ 未検出'} |`)
  if (tracker.found) {
    const via = tracker.via === 'gtm' ? 'GTM経由' : tracker.via === 'direct' ? '直接設置' : '不明'
    lines.push(`| 設置方法 | ${via} |`)
    lines.push(`| キャンペーンID | ${tracker.campaignId ?? '⚠ 未設定'} |`)
    lines.push(`| 置換対象電話番号 | ${tracker.phoneNumbers.length > 0 ? tracker.phoneNumbers.join(', ') : '⚠ 未設定'} |`)
    lines.push(`| LINE友だち追加計測 | ${tracker.lineFriendAdd.found ? '✅ あり' : '— なし'} |`)
    if (tracker.lineFriendAdd.found) {
      lines.push(`| 対象セレクタ | \`${(tracker.lineFriendAdd.selector ?? '').replace(/\|/g, '\\|')}\` |`)
      const elStatus =
        tracker.lineFriendAdd.elementExists === null
          ? '— 未確認'
          : tracker.lineFriendAdd.elementExists
          ? '✅ 要素あり'
          : '❌ 要素なし'
      lines.push(`| 要素の存在確認 | ${elStatus} |`)
    }
  }
  lines.push(``)

  // GTM
  lines.push(`## Google Tag Manager`)
  lines.push(``)
  lines.push(`| 項目 | 値 |`)
  lines.push(`|------|-----|`)
  lines.push(`| ステータス | ${gtm.found ? '✅ 検出' : '— 未検出'} |`)
  if (gtm.found) {
    lines.push(`| コンテナID | ${gtm.ids.join(', ')} |`)
  }
  lines.push(``)

  // GA4
  lines.push(`## Google Analytics 4`)
  lines.push(``)
  lines.push(`| 項目 | 値 |`)
  lines.push(`|------|-----|`)
  lines.push(`| ステータス | ${ga4.found ? '✅ 検出' : '— 未検出'} |`)
  if (ga4.found) {
    lines.push(`| 測定ID | ${ga4.ids.join(', ')} |`)
  }
  lines.push(``)

  // コンソールエラーログ
  if (result.consoleErrors.length > 0) {
    lines.push(`## コンソールエラーログ`)
    lines.push(``)
    result.consoleErrors.forEach((e, i) => lines.push(`${i + 1}. ${e}`))
    lines.push(``)
  }

  // エラーログ
  if (errors.length > 0) {
    lines.push(`## エラーログ`)
    lines.push(``)
    errors.forEach((e, i) => lines.push(`${i + 1}. ${e}`))
    lines.push(``)
  }

  return lines.join('\n')
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [apiError, setApiError] = useState('')
  const [copied, setCopied] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const handleCheck = async () => {
    if (!url.trim()) return
    setStatus('loading')
    setResult(null)
    setApiError('')
    setCopied(false)

    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setApiError(data.error || 'エラーが発生しました')
        setStatus('error')
        return
      }
      setResult(data)
      setStatus('done')
    } catch {
      setApiError('サーバーへの接続に失敗しました')
      setStatus('error')
    }
  }

  const handleCopy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(buildMarkdown(result))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>◈</span>
          <span>計測タグChecker</span>
        </div>
        <p className={styles.sub}>Call Data Bank 計測タグ診断ツール</p>
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
          <button
            className={styles.btn}
            onClick={handleCheck}
            disabled={status === 'loading' || !url.trim()}
          >
            {status === 'loading' ? (
              <span className={styles.spinner} />
            ) : (
              '診断する'
            )}
          </button>
        </div>
        {status === 'loading' && (
          <p className={styles.loadingMsg}>
            ページを解析中です。10〜20秒ほどかかります...
          </p>
        )}
        {status === 'error' && (
          <p className={styles.errorMsg}>⚠ {apiError}</p>
        )}
      </div>

      {result && (
        <div className={styles.results}>

          {/* tracker.js */}
          <Section
            title="tracker.js（計測タグ）"
            status={result.tracker.found ? 'ok' : 'ng'}
          >
            <Row label="ステータス" value={result.tracker.found ? '✅ 検出' : '❌ 未検出'} highlight={result.tracker.found} error={!result.tracker.found} />
            {result.tracker.found && (
              <>
                <Row
                  label="設置方法"
                  value={
                    result.tracker.via === 'gtm'
                      ? '📦 GTM経由'
                      : result.tracker.via === 'direct'
                      ? '📄 直接設置'
                      : '不明'
                  }
                />
                <Row
                  label="キャンペーンID"
                  value={result.tracker.campaignId ?? '⚠ 未設定'}
                  warn={!result.tracker.campaignId}
                  mono
                />
                <Row
                  label="置換対象電話番号"
                  value={
                    result.tracker.phoneNumbers.length > 0
                      ? result.tracker.phoneNumbers.join(' / ')
                      : '⚠ 未設定'
                  }
                  warn={result.tracker.phoneNumbers.length === 0}
                  mono
                />
                <Row
                  label="LINE友だち追加計測"
                  value={result.tracker.lineFriendAdd.found ? '✅ あり' : '— なし'}
                />
                {result.tracker.lineFriendAdd.found && (
                  <>
                    <Row
                      label="対象セレクタ"
                      value={result.tracker.lineFriendAdd.selector ?? ''}
                      mono
                    />
                    <Row
                      label="要素の存在確認"
                      value={
                        result.tracker.lineFriendAdd.elementExists === null
                          ? '— 未確認'
                          : result.tracker.lineFriendAdd.elementExists
                          ? '✅ 要素あり'
                          : '❌ 要素なし'
                      }
                      highlight={result.tracker.lineFriendAdd.elementExists === true}
                      error={result.tracker.lineFriendAdd.elementExists === false}
                    />
                  </>
                )}
              </>
            )}
          </Section>

          {/* GTM */}
          <Section
            title="Google Tag Manager"
            status={result.gtm.found ? 'ok' : 'warn'}
          >
            <Row
              label="ステータス"
              value={result.gtm.found ? '✅ 検出' : '— 未検出'}
              highlight={result.gtm.found}
            />
            {result.gtm.found && (
              <Row label="コンテナID" value={result.gtm.ids.join(', ')} mono />
            )}
          </Section>

          {/* GA4 */}
          <Section
            title="Google Analytics 4"
            status={result.ga4.found ? 'ok' : 'warn'}
          >
            <Row
              label="ステータス"
              value={result.ga4.found ? '✅ 検出' : '— 未検出'}
              highlight={result.ga4.found}
            />
            {result.ga4.found && (
              <Row label="測定ID" value={result.ga4.ids.join(', ')} mono />
            )}
          </Section>

          {/* コンソールエラーログ */}
          {result.consoleErrors.length > 0 && (
            <Section title="コンソールエラーログ" status="warn">
              {result.consoleErrors.map((e, i) => (
                <Row key={i} label={`[${i + 1}]`} value={e} warn />
              ))}
            </Section>
          )}

          {/* エラーログ */}
          {result.errors.length > 0 && (
            <Section title="エラーログ" status="warn">
              {result.errors.map((e, i) => (
                <Row key={i} label={`[${i + 1}]`} value={e} warn />
              ))}
            </Section>
          )}

          <div className={styles.footer}>
            <p className={styles.timestamp}>
              診断日時: {new Date(result.trackedAt).toLocaleString('ja-JP')}
            </p>
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
              <li><a className={styles.legalLink} href="https://call.omnidatabank.jp/&utm_source=tag_checker" target="_blank" rel="noopener noreferrer">Call Data Bank</a> は<a className={styles.legalLink} href="https://lograph.co.jp/" target="_blank" rel="noopener noreferrer">株式会社ログラフ</a>の登録商標です。</li>
              <li>本ツールは診断対象サイトの情報を保存せず、第三者への提供も一切行いません。</li>
              <li>本ツールの利用により生じたいかなる損害についても、提供者は責任を負いかねます。</li>
            </ul>
          </div>
        </div>
      )}
    </main>
  )
}

function Section({
  title,
  status,
  children,
}: {
  title: string
  status: 'ok' | 'warn' | 'ng'
  children: React.ReactNode
}) {
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

function Row({
  label,
  value,
  highlight,
  warn,
  error,
  mono,
}: {
  label: string
  value: string
  highlight?: boolean
  warn?: boolean
  error?: boolean
  mono?: boolean
}) {
  const valueClass = [
    styles.rowValue,
    highlight ? styles.valueHighlight : '',
    warn ? styles.valueWarn : '',
    error ? styles.valueError : '',
    mono ? styles.valueMono : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}
