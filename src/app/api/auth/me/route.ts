import { NextRequest, NextResponse } from 'next/server'

const CDB_API = 'https://api-2.omni-databank.com'

export async function GET(req: NextRequest) {
  const token = req.cookies.get('cdb_token')?.value

  if (!token) {
    return NextResponse.json({ error: '未認証' }, { status: 401 })
  }

  try {
    const res = await fetch(`${CDB_API}/me`, {
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
