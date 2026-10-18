#!/usr/bin/env bash
# Writes the release description for tag $1 to stdout: every commit since
# the previous tag (title and details), then where to download.
set -euo pipefail
tag="$1"
repo="${GITHUB_REPOSITORY:-GeekFreak01/spline}"
prev=$(git describe --tags --abbrev=0 "${tag}^" 2>/dev/null || true)
range="${prev:+${prev}..}${tag}"
version="${tag#v}"

echo "## Что нового · What's new"
echo
git log --reverse --no-merges --format='### %s%n%n%b' "$range" | sed -e '/^$/N;/^\n$/D'
echo
echo "## Скачать · Download"
echo
echo "- **Windows:** [Spline-Setup-${version}.exe](https://github.com/${repo}/releases/download/${tag}/Spline-Setup-${version}.exe) — установщик, ставится поверх старой версии · installer, installs over the old version"
echo "- **Без установки · Portable:** \`spline-windows-amd64.exe\`, \`spline-macos-arm64\`, \`spline-macos-amd64\`, \`spline-linux-amd64\` ниже · below"
echo "- **В браузере · In the browser:** https://spline.geekfreak.tv"
if [ -n "$prev" ]; then
  echo
  echo "**Все изменения · Full changelog:** https://github.com/${repo}/compare/${prev}...${tag}"
fi
