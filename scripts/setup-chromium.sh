#!/usr/bin/env bash
# © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
#
# Provisioniert Chromium für die Browser-Suiten in Umgebungen ohne
# Paketmanager (CI-Sandbox, Container ohne apt).
#
# Warum das nötig ist: `puppeteer` lädt seinen Browser über
# storage.googleapis.com – in dieser Sandbox nicht erreichbar (HTTP 000).
# Erreichbar sind dagegen registry.npmjs.org, codeload.github.com und
# api.github.com. Also:
#   1. Chromium-Binary aus dem npm-Paket `@sparticuz/chromium` (liegt im Tarball,
#      keine Laufzeit-Downloads).
#   2. NSS/NSPR aus den Quellen bauen (Chromium braucht `libnss3.so`,
#      `libnssutil3.so`, `libnssmime3.so`, `libfreebl3.so`, `libsoftokn3.so`,
#      `libnspr4.so`, `libplc4.so`, `libplds4.so`).
#
# Ergebnis:
#   /tmp/chromium      – das Binary
#   /tmp/chromelibs/   – die Shared Libraries
#
# Danach laufen alle Suiten mit:
#   PUPPETEER_EXECUTABLE_PATH=/tmp/chromium \
#   LD_LIBRARY_PATH=/tmp/chromelibs \
#   QA_FIXTURES=on npm run qa:modules
#
# Hinweis: Der NSS-`signtool` scheitert ohne `zlib.h`; das bricht nur den
# Werkzeug-Teil ab, nicht die Bibliotheken, die Chromium lädt. Der Fehler wird
# deshalb bewusst toleriert.

set -euo pipefail

WORK="${WORK:-/tmp/nc-chromium-setup}"
CHROMIUM_OUT="${CHROMIUM_OUT:-/tmp/chromium}"
LIBS_OUT="${LIBS_OUT:-/tmp/chromelibs}"

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }

mkdir -p "$WORK" "$LIBS_OUT"

# ---------------------------------------------------------------- 1) Chromium
log "Chromium-Binary besorgen (@sparticuz/chromium@153.0.0)"
if [ ! -x "$CHROMIUM_OUT" ]; then
  mkdir -p "$WORK/chromium-node"
  ( cd "$WORK/chromium-node" \
      && npm init -y >/dev/null 2>&1 \
      && npm install @sparticuz/chromium@153.0.0 --no-audit --no-fund >/dev/null )
  node -e "
    const m = require('$WORK/chromium-node/node_modules/@sparticuz/chromium/build/index.js');
    const C = m.default ?? m;
    C.executablePath().then((p) => console.log(p));
  " > "$WORK/exe-path.txt"
  EXE="$(tail -n 1 "$WORK/exe-path.txt")"
  cp "$EXE" "$CHROMIUM_OUT" 2>/dev/null || true
  chmod +x "$CHROMIUM_OUT"
  ok "Binary: $CHROMIUM_OUT"
else
  ok "Binary vorhanden: $CHROMIUM_OUT"
fi

# ------------------------------------------------------------------- 2) NSPR
log "NSPR aus den Quellen bauen (mozilla/nspr, NSPR_4_36_BRANCH)"
if [ ! -f "$WORK/nssroot/lib/libnspr4.so" ]; then
  mkdir -p "$WORK/nssroot"
  curl -sSL -o "$WORK/nspr.tar.gz" \
    "https://codeload.github.com/mozilla/nspr/tar.gz/refs/heads/NSPR_4_36_BRANCH"
  tar xzf "$WORK/nspr.tar.gz" -C "$WORK"
  (
    cd "$WORK/nspr-NSPR_4_36_BRANCH"
    mkdir -p buildout && cd buildout
    # --enable-64bit ist Pflicht: ohne das Flag baut configure 32-bit (-m32),
    # und der Link scheitert an fehlenden 32-bit-libc-Headern.
    ../configure --disable-debug --enable-optimize --enable-64bit \
      --prefix="$WORK/nssroot" > /dev/null
    make -j"$(nproc)" > /dev/null
    make install > /dev/null
  )
  ok "NSPR installiert: $WORK/nssroot/lib"
else
  ok "NSPR vorhanden: $WORK/nssroot/lib"
fi

# -------------------------------------------------------------------- 3) NSS
log "NSS aus den Quellen bauen (nss-dev/nss, NSS_3_101_RTM)"
if [ ! -f "$WORK/nss-NSS_3_101_RTM/lib/nss"/*/libnss3.so ] 2>/dev/null; then
  if [ ! -d "$WORK/nss-NSS_3_101_RTM" ]; then
    curl -sSL -o "$WORK/nss.tar.gz" \
      "https://codeload.github.com/nss-dev/nss/tar.gz/refs/tags/NSS_3_101_RTM"
    tar xzf "$WORK/nss.tar.gz" -C "$WORK"
  fi
  # NSS erwartet NSPR als Schwesterverzeichnis `../nspr` (relativ zum NSS-Root).
  rm -rf "$WORK/nspr"
  cp -r "$WORK/nspr-NSPR_4_36_BRANCH" "$WORK/nspr"
  (
    cd "$WORK/nss-NSS_3_101_RTM"
    # `|| true`: der signtool-Teil braucht zlib.h und bricht ab; die
    # Bibliotheken entstehen vorher vollständig.
    make nss_build_all USE_64=1 BUILD_OPT=1 > "$WORK/nss-build.log" 2>&1 || true
  )
  if ! ls "$WORK/nss-NSS_3_101_RTM/lib/nss"/*/libnss3.so >/dev/null 2>&1; then
    echo "FEHLER: libnss3.so wurde nicht gebaut – siehe $WORK/nss-build.log" >&2
    exit 1
  fi
  ok "NSS gebaut (signtool-Abbruch toleriert)"
else
  ok "NSS vorhanden"
fi

# --------------------------------------------------------------- 4) Libs sammeln
log "Bibliotheken flach nach $LIBS_OUT kopieren"
find "$WORK/nss-NSS_3_101_RTM/lib" -name 'lib*.so' -path '*Linux*' -print0 2>/dev/null \
  | while IFS= read -r -d '' f; do cp -Ln "$f" "$LIBS_OUT/" 2>/dev/null || true; done
cp -L "$WORK/nssroot/lib/"*.so "$LIBS_OUT/" 2>/dev/null || true
ok "$(ls "$LIBS_OUT"/*.so 2>/dev/null | wc -l) Bibliotheken kopiert"

# ----------------------------------------------------------------- 5) Prüfen
log "Selbsttest"
if LD_LIBRARY_PATH="$LIBS_OUT" "$CHROMIUM_OUT" --version >/dev/null 2>&1; then
  ok "Chromium startet: $(LD_LIBRARY_PATH="$LIBS_OUT" "$CHROMIUM_OUT" --version)"
else
  echo "FEHLER: Chromium startet nicht. Fehlende Libs:" >&2
  LD_LIBRARY_PATH="$LIBS_OUT" ldd "$CHROMIUM_OUT" | grep 'not found' >&2 || true
  exit 1
fi

cat <<EOF

Fertig. Für die Browser-Suiten:

  export PUPPETEER_EXECUTABLE_PATH=$CHROMIUM_OUT
  export LD_LIBRARY_PATH=$LIBS_OUT
  export QA_FIXTURES=on
  npm run build && npm run start &   # Production-Server auf :3000
  npm run qa:modules
EOF
