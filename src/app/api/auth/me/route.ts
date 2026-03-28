import { NextRequest, NextResponse } from 'next/server'

const OEM_API: Record<string, string> = {
  cdb:   'https://api-2.omni-databank.com',
  adsip: 'https://api-2.omni-databank.com',
  ivry:  'https://api.callapps.net',
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cdb_token')?.value
  const oem = req.cookies.get('cdb_oem')?.value ?? 'cdb'

  if (!token) {
    return NextResponse.json({ error: '未認証' }, { status: 401 })
  }

  const api = OEM_API[oem] ?? OEM_API.cdb

  try {
    const res = await fetch(`${api}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'トークンが無効です' }, { status: 401 })
    }

    const me = await res.json()
    return NextResponse.json({ ok: true, label: me?.label ?? '' })
  } catch {
    return NextResponse.json({ error: '認証確認に失敗しました' }, { status: 500 })
  }
}
