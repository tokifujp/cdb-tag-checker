import { NextRequest, NextResponse } from 'next/server'

const CDB_API = 'https://api-2.omni-databank.com'

export async function POST(req: NextRequest) {
  const { sid, email, password } = await req.json()

  if (!sid || !email || !password) {
    return NextResponse.json({ error: 'sid・メールアドレス・パスワードを入力してください' }, { status: 400 })
  }

  try {
    const res = await fetch(`${CDB_API}/authentications`, {
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
    const meRes = await fetch(`${CDB_API}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const me = await meRes.json()

    const response = NextResponse.json({ ok: true, label: me?.label ?? '' })

    // accessTokenをHttpOnly Cookieに保存
    response.cookies.set('cdb_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 30, // 30分
    })

    return response
  } catch {
    return NextResponse.json({ error: 'ログインに失敗しました' }, { status: 500 })
  }
}
