import { NextRequest, NextResponse } from 'next/server'

// OEM環境定義
const OEM_CONFIG: Record<string, { api: string; label: string }> = {
  cdb:   { api: 'https://api-2.omni-databank.com', label: 'コールデータバンク' },
  adsip: { api: 'https://api-2.omni-databank.com', label: 'AdSiP' },
  ivry:  { api: 'https://api.callapps.net',         label: 'IVRy' },
}

// sid マッピング
const OEM_SID: Record<string, string> = {
  cdb:   '1',
  adsip: '3',
  ivry:  '1',
}

export async function POST(req: NextRequest) {
  const { oem, email, password } = await req.json()

  const config = OEM_CONFIG[oem]
  if (!config || !email || !password) {
    return NextResponse.json({ error: '環境・メールアドレス・パスワードを入力してください' }, { status: 400 })
  }

  const sid = OEM_SID[oem]

  try {
    const res = await fetch(`${config.api}/authentications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, email, password }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'メールアドレス・パスワードが正しくありません' }, { status: 401 })
    }

    const data = await res.json()
    const accessToken = data.accessToken

    // /me でユーザー情報を取得
    const meRes = await fetch(`${config.api}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const me = await meRes.json()

    const response = NextResponse.json({ ok: true, label: me?.label ?? '' })

    response.cookies.set('cdb_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 30,
      secure: process.env.NODE_ENV === 'production',
    })

    return response
  } catch {
    return NextResponse.json({ error: 'ログインに失敗しました' }, { status: 500 })
  }
}
