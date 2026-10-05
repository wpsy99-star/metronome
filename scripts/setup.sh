#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if(Number(process.versions.node.split(".")[0])<22) throw Error("Node.js 22.13+ is required")'
python3 --version
npm ci --cache /workspace/.npm-cache
mkdir -p tools/audiveris data/config/AudiverisLtd/audiveris/tessdata
if [ ! -x tools/audiveris/opt/audiveris/bin/Audiveris ]; then
  task_deb="$(mktemp /tmp/measure-audiveris.XXXXXX.deb)"
  trap 'rm -f "$task_deb"' EXIT
  curl --fail --location --show-error https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu22.04-x86_64.deb -o "$task_deb"
  echo "ae714594f40e54b1a4951fc3f914f08ae38fe5d07b7f2283b1a904fdb6e0a318  $task_deb" | sha256sum --check
  dpkg-deb --extract "$task_deb" tools/audiveris
fi
if [ ! -f data/config/AudiverisLtd/audiveris/tessdata/eng.traineddata ]; then
  curl --fail --location --show-error https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata -o data/config/AudiverisLtd/audiveris/tessdata/eng.traineddata
fi
echo '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2  data/config/AudiverisLtd/audiveris/tessdata/eng.traineddata' | sha256sum --check
XDG_CONFIG_HOME="$PWD/data/config" XDG_CACHE_HOME="$PWD/data/cache" tools/audiveris/opt/audiveris/bin/Audiveris -help >/dev/null
