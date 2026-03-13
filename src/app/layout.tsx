import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '計測タグChecker | Call Data Bank',
  description: '計測タグ診断ツール',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
