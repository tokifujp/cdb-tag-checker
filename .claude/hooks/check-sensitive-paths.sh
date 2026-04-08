#!/bin/bash
# PreToolUseフック: 作業ディレクトリ以外へのアクセスをブロック

# 標準入力からツール情報をJSON形式で受け取る
input=$(cat)

# ツール名を取得
tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# パスを抽出（Bashの場合はcommand、Read/Edit/Writeの場合はfile_path）
if [ "$tool_name" = "Bash" ]; then
  target=$(echo "$input" | jq -r '.tool_input.command // ""')
else
  target=$(echo "$input" | jq -r '.tool_input.file_path // ""')
fi

# 作業ディレクトリを動的に取得
# スクリプトの場所から2階層上（プロジェクトルート）を取得
WORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 共通: パスの許可判定
is_allowed_path() {
  local resolved="$1"
  if [[ "$resolved" == "$WORK_DIR"* ]] || [[ "$resolved" == "/tmp/claude"* ]] || [[ "$resolved" == "/private/tmp/claude"* ]] || [[ "$resolved" == "/dev/"* ]]; then
    return 0
  fi
  return 1
}

# Python の realpath でシンボリックリンク解決（macOS互換）
resolve_realpath() {
  local base="$1"
  local path="$2"
  local py_bin="python3"
  if ! command -v "$py_bin" >/dev/null 2>&1; then
    py_bin="python"
  fi
  "$py_bin" - <<'PY' "$base" "$path"
import os
import sys
base = sys.argv[1]
path = sys.argv[2]
if os.path.isabs(path):
    p = path
else:
    p = os.path.join(base, path)
print(os.path.realpath(p))
PY
}

# シンボリックリンクチェック（Read/Edit/Writeツールのみ）
# パス内のすべての要素をチェックして、シンボリックリンク経由のアクセスを防ぐ
if [ "$tool_name" != "Bash" ] && [ -n "$target" ]; then
  resolved_path=$(resolve_realpath "$WORK_DIR" "$target" 2>/dev/null)
  if [ -n "$resolved_path" ]; then
    if ! is_allowed_path "$resolved_path"; then
      echo "{\"decision\": \"block\", \"reason\": \"パスが作業ディレクトリ外を参照しています: $target -> $resolved_path\"}"
      exit 0
    fi
  else
    # 解決できない場合は親ディレクトリをチェック
    parent_dir=$(dirname "$target")
    resolved_parent=$(resolve_realpath "$WORK_DIR" "$parent_dir" 2>/dev/null)
    if [ -n "$resolved_parent" ] && ! is_allowed_path "$resolved_parent"; then
      echo "{\"decision\": \"block\", \"reason\": \"パスの親ディレクトリが作業ディレクトリ外を参照しています: $target (親: $resolved_parent)\"}"
      exit 0
    fi
  fi
fi

# Git コマンドのセキュリティチェック（プロンプトインジェクション対策）
if [ "$tool_name" = "Bash" ]; then
  # git remote add をブロック（攻撃者のリモートリポジトリ追加を防止）
  if [[ "$target" == *"git remote add"* ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"git remote add は禁止されています（セキュリティリスク）\"}"
    exit 0
  fi

  # origin 以外への git push をブロック
  if [[ "$target" == *"git push"* ]]; then
    # origin が含まれていれば許可
    if [[ "$target" == *" origin"* ]]; then
      :  # 許可
    else
      # origin が含まれていない場合、リモート名が指定されているかチェック
      # "git push" の後に、オプション（-で始まる）を0個以上スキップして、
      # その後に英小文字で始まる単語がある場合、それをリモート名と見なす
      if [[ "$target" =~ git\ push(\ +-[a-zA-Z0-9]+)*(\ +)([a-z][a-z0-9_-]*) ]]; then
        # リモート名が抽出された（BASH_REMATCH[3]）
        remote="${BASH_REMATCH[3]}"
        if [[ "$remote" != "origin" ]]; then
          echo "{\"decision\": \"block\", \"reason\": \"origin 以外のリモートへの git push は禁止されています\"}"
          exit 0
        fi
      fi
    fi
  fi

  # git clone で外部 URL をブロック（ローカルパスのみ許可）
  if [[ "$target" == *"git clone"* ]]; then
    # http://, https://, git@, ssh:// などのプロトコルを含む場合はブロック
    if [[ "$target" =~ git[[:space:]]+clone[[:space:]]+(https?://|git@|ssh://) ]]; then
      echo "{\"decision\": \"block\", \"reason\": \"外部リポジトリからの git clone は禁止されています\"}"
      exit 0
    fi
  fi

  # まず ../ パターンをチェック（これは常にブロック）
  if [[ "$target" == *"../"* ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"親ディレクトリへのアクセスは禁止されています\"}"
    exit 0
  fi

  # 次に .. パターンをチェック（git範囲指定のみ許可）
  if [[ "$target" == *".."* ]]; then
    # git範囲指定の正規表現パターン
    # 形式: [ref]..[ref] または [ref]...[ref]
    # ref は以下の文字を含む: 英数字、ドット、ハイフン、スラッシュ、アンダースコア、^、~
    # 例: HEAD..origin/main, main...feature, v1.2..v1.3, HEAD~3..HEAD^
    GIT_RANGE_PATTERN='[a-zA-Z0-9._/^~-]+\.\.\.?[a-zA-Z0-9._/^~-]*'

    # gitコマンドが含まれている場合のみホワイトリストチェック
    if [[ "$target" == *"git "* ]]; then
      # git範囲指定パターンをすべて一時的な文字列に置換
      sanitized="$target"
      sanitized=$(echo "$sanitized" | sed -E "s/$GIT_RANGE_PATTERN/GITRANGE/g")

      # 置換後にまだ .. が残っている場合は親ディレクトリアクセス
      if [[ "$sanitized" == *".."* ]]; then
        echo "{\"decision\": \"block\", \"reason\": \"親ディレクトリへのアクセスは禁止されています\"}"
        exit 0
      fi
      # 残っていない場合は、すべての .. がgit範囲指定なので許可
    else
      # gitコマンドが含まれない場合は .. を無条件ブロック
      echo "{\"decision\": \"block\", \"reason\": \"親ディレクトリへのアクセスは禁止されています\"}"
      exit 0
    fi
  fi

  # ホームディレクトリ（~）への早期チェック
  # Pythonのトークン解析前にブロックすることで、より確実に防御
  # 注意: git の HEAD~3 などは許可するため、トークン先頭のみを対象にする
  if [[ "$target" =~ (^|[[:space:]])~[A-Za-z0-9._-]*(/|$) ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"ホームディレクトリへのアクセスは禁止されています\"}"
    exit 0
  fi
fi

# Bash: コマンド中のパス検出＆チェック
if [ "$tool_name" = "Bash" ] && [ -n "$target" ]; then
  py_bin="python3"
  if ! command -v "$py_bin" >/dev/null 2>&1; then
    py_bin="python"
  fi
  "$py_bin" - <<'PY' "$WORK_DIR" "$target" || exit 0
import os
import re
import shlex
import sys

work_dir = sys.argv[1]
cmd = sys.argv[2]

ALLOWED_PREFIXES = [work_dir, "/tmp/claude", "/private/tmp/claude", "/dev/"]

def is_allowed(resolved: str) -> bool:
    return any(resolved.startswith(p) for p in ALLOWED_PREFIXES)

# Git範囲指定（ref..ref / ref...ref）
GIT_RANGE = re.compile(r"[A-Za-z0-9._/^~-]+\.\.\.?[A-Za-z0-9._/^~-]*\Z")

# シェル演算子で分割（複合コマンドの抜けを防ぐ）
segments = re.split(r"&&|\|\||;|\n", cmd)

for seg in segments:
    seg = seg.strip()
    if not seg:
        continue

    try:
        tokens = shlex.split(seg)
    except Exception:
        # 解析不能なら保守的にブロック
        print('{"decision": "block", "reason": "コマンド解析に失敗しました（安全のためブロック）"}')
        sys.exit(0)

    is_git = len(tokens) > 0 and tokens[0] == "git"

    for tok in tokens:
        # git範囲指定は .. を含んでも許可
        if is_git and GIT_RANGE.match(tok):
            continue

        # 明示的な .. や ../ をブロック
        if tok == ".." or "../" in tok or tok.startswith("../"):
            print('{"decision": "block", "reason": "親ディレクトリへのアクセスは禁止されています"}')
            sys.exit(0)

        # ~ 展開はブロック
        if tok.startswith("~"):
            print('{"decision": "block", "reason": "ホームディレクトリへのアクセスは禁止されています"}')
            sys.exit(0)

        # パスっぽいトークンのみチェック
        if tok.startswith("/") or tok.startswith("./") or "/" in tok:
            if os.path.isabs(tok):
                resolved = os.path.realpath(tok)
            else:
                resolved = os.path.realpath(os.path.join(work_dir, tok))
            if not is_allowed(resolved):
                print('{"decision": "block", "reason": "作業ディレクトリ外へのアクセスは禁止されています: %s"}' % tok)
                sys.exit(0)
PY
fi

# Bash 以外のツール（Read/Edit/Write）の場合、通常の親ディレクトリチェック
if [ "$tool_name" != "Bash" ]; then
  if [[ "$target" == *"../"* ]] || [[ "$target" == *".."* ]]; then
    echo "{\"decision\": \"block\", \"reason\": \"親ディレクトリへのアクセスは禁止されています\"}"
    exit 0
  fi
fi

# 禁止パターンのチェック
# 1. ホームディレクトリ（~）へのアクセス
if [[ "$target" == ~* ]] || [[ "$target" == *"~/"* ]]; then
  echo "{\"decision\": \"block\", \"reason\": \"ホームディレクトリへのアクセスは禁止されています\"}"
  exit 0
fi

# 2. 絶対パスの場合、作業ディレクトリ外をブロック
if [[ "$target" == /* ]] && [[ "$target" != "$WORK_DIR"* ]] && [[ "$target" != "/tmp/claude"* ]] && [[ "$target" != "/private/tmp/claude"* ]] && [[ "$target" != "/dev/"* ]]; then
  echo "{\"decision\": \"block\", \"reason\": \"作業ディレクトリ外へのアクセスは禁止されています: $target\"}"
  exit 0
fi

# 許可
exit 0