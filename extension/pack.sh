#!/usr/bin/env bash
# 打包 Chrome 扩展为可分发 zip。
# 用法:在任意目录执行 `bash extension/pack.sh`,产物在 extension/dist/。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# 需要进包的文件(白名单,避免把 dist/pack.sh 等打进去)
FILES=(manifest.json background.js inject.js content.js popup.html popup.js)
ICONS=(icons/icon16.png icons/icon48.png icons/icon128.png)

for f in "${FILES[@]}" "${ICONS[@]}"; do
  [ -f "$f" ] || { echo "缺少文件:$f" >&2; exit 1; }
done

VERSION="$(node -e "process.stdout.write(require('./manifest.json').version)")"
OUT_DIR="dist"
OUT="$OUT_DIR/social-post-fb-extension-v${VERSION}.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT"
zip -q -X "$OUT" "${FILES[@]}" "${ICONS[@]}"

echo "✅ 打包完成:$DIR/$OUT"
echo "   分发装法:解压后在 chrome://extensions 开发者模式「加载已解压的扩展程序」选解压目录。"
