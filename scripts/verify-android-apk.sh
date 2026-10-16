#!/usr/bin/env bash
# Vérification structurelle et cryptographique d'un APK Melodix avant publication.
# Cette vérification ne remplace pas un test sur appareil, mais bloque les causes
# d'installation détectables hors appareil (ZIP/manifest/package/ABI/signature).
set -Eeuo pipefail

APK=${1:?Usage: verify-android-apk.sh APK [rapport]}
REPORT=${2:-apk-inspection.txt}
EXPECTED_PACKAGE=${EXPECTED_PACKAGE:-com.souxch06.melodix}
# Version attendue : source UNIQUE = app.config.js. Des constantes en dur
# (45002 / 4.5.0-test.2) divergeaient à chaque bump. `node` est disponible.
# Les variables EXPECTED_* restent des surcharges explicites (le workflow les
# passe) ; le repli ne sert qu'à un usage local sans node.
if [ -z "${EXPECTED_VERSION_CODE:-}" ]; then
  EXPECTED_VERSION_CODE=$(node -p "require('./app.config.js').expo.android.versionCode" 2>/dev/null || true)
fi
[ -n "${EXPECTED_VERSION_CODE:-}" ] || EXPECTED_VERSION_CODE=45003
if [ -z "${EXPECTED_VERSION_NAME:-}" ]; then
  EXPECTED_VERSION_NAME=$(node -p "require('./app.config.js').expo.version" 2>/dev/null || true)
fi
[ -n "${EXPECTED_VERSION_NAME:-}" ] || EXPECTED_VERSION_NAME=4.5.0-test.3
EXPECTED_MIN_SDK=${EXPECTED_MIN_SDK:-23}
EXPECTED_TARGET_SDK=${EXPECTED_TARGET_SDK:-34}
EXPECTED_SCHEME=${EXPECTED_SCHEME:-melodix}
EXPECTED_ABIS=${EXPECTED_ABIS:-arm64-v8a,armeabi-v7a,x86,x86_64}
# Optionnel : permet au dépôt de verrouiller le certificat d'une série de
# builds. Une valeur vide conserve seulement la vérification cryptographique.
EXPECTED_CERT_SHA256=${EXPECTED_CERT_SHA256:-}

fail() {
  printf 'ERREUR APK: %s\n' "$*" >&2
  exit 1
}

find_build_tool() {
  local name=$1
  local candidate
  candidate=$(find "${ANDROID_HOME:?ANDROID_HOME absent}"/build-tools -mindepth 2 -maxdepth 2 -type f -name "$name" -print 2>/dev/null | sort -V | tail -1)
  [[ -n "$candidate" ]] || fail "outil Android introuvable: $name"
  printf '%s' "$candidate"
}

find_sdk_tool() {
  local name=$1
  local candidate
  candidate=$(command -v "$name" 2>/dev/null || true)
  if [[ -z "$candidate" ]]; then
    candidate=$(find "${ANDROID_HOME:?ANDROID_HOME absent}"/cmdline-tools -type f -name "$name" -print 2>/dev/null | sort -V | tail -1)
  fi
  [[ -n "$candidate" ]] || fail "outil Android SDK introuvable: $name"
  printf '%s' "$candidate"
}

[[ -f "$APK" ]] || fail "fichier absent: $APK"
[[ -s "$APK" ]] || fail "fichier vide: $APK"
size=$(stat -c '%s' "$APK")
(( size >= 1000000 )) || fail "fichier anormalement petit: $size octets"

AAPT2=$(find_build_tool aapt2)
APKSIGNER=$(find_build_tool apksigner)
ZIPALIGN=$(find_build_tool zipalign)
APKANALYZER=$(find_sdk_tool apkanalyzer)

# Le rapport est aussi publié avec l'APK : il permet de diagnostiquer un refus
# d'installation sans dépendre des logs éphémères du runner.
exec > >(tee "$REPORT") 2>&1

echo "APK=$APK"
echo "source_commit=${BUILD_SHA:-unknown}"
echo "size_bytes=$size"
echo "sha256=$(sha256sum "$APK" | awk '{print $1}')"
echo

echo '=== Intégrité ZIP ==='
unzip -t "$APK"

entries=$(unzip -Z1 "$APK")
grep -qx 'AndroidManifest.xml' <<<"$entries" || fail 'AndroidManifest.xml absent'
grep -Eq '^classes([0-9]*)?\.dex$' <<<"$entries" || fail 'aucun DEX présent'
grep -qx 'assets/index.android.bundle' <<<"$entries" || fail 'bundle React Native absent'

echo
echo '=== aapt2 dump badging ==='
badging=$($AAPT2 dump badging "$APK")
printf '%s\n' "$badging"

package_line=$(grep '^package:' <<<"$badging" | head -1)
package_name=$(sed -n "s/.* name='\([^']*\)'.*/\1/p" <<<"$package_line")
version_code=$(sed -n "s/.* versionCode='\([^']*\)'.*/\1/p" <<<"$package_line")
version_name=$(sed -n "s/.* versionName='\([^']*\)'.*/\1/p" <<<"$package_line")
[[ "$package_name" == "$EXPECTED_PACKAGE" ]] || fail "package '$package_name' != '$EXPECTED_PACKAGE'"
[[ "$version_code" == "$EXPECTED_VERSION_CODE" ]] || fail "versionCode '$version_code' != '$EXPECTED_VERSION_CODE'"
[[ "$version_name" == "$EXPECTED_VERSION_NAME" ]] || fail "versionName '$version_name' != '$EXPECTED_VERSION_NAME'"
# apkanalyzer est utilisé pour les SDK : contrairement à `aapt2 badging`, il
# expose ces valeurs de façon stable avec les build-tools récents.
min_sdk=$($APKANALYZER manifest min-sdk "$APK" | tr -d '\r\n')
target_sdk=$($APKANALYZER manifest target-sdk "$APK" | tr -d '\r\n')
echo "apkanalyzer: minSdk=$min_sdk targetSdk=$target_sdk"
[[ "$min_sdk" == "$EXPECTED_MIN_SDK" ]] || fail "minSdk '$min_sdk' != '$EXPECTED_MIN_SDK'"
[[ "$target_sdk" == "$EXPECTED_TARGET_SDK" ]] || fail "targetSdk '$target_sdk' != '$EXPECTED_TARGET_SDK'"

echo
echo '=== AndroidManifest final ==='
# `aapt2 badging` n'émet plus systématiquement de ligne `schemes:`. Le XML
# décodé par apkanalyzer est le contrat stable pour le deep-link et les
# composants du manifest fusionné réellement embarqué.
manifest_xml=$($APKANALYZER manifest print "$APK")
printf '%s\n' "$manifest_xml"
grep -Fq "android:scheme=\"$EXPECTED_SCHEME\"" <<<"$manifest_xml" || fail "scheme '$EXPECTED_SCHEME' absent"
grep -Fq 'android:name="expo.modules.melodixmedia.MelodixMediaService"' <<<"$manifest_xml" || fail 'MediaSessionService absent du manifest final'
# apkanalyzer peut omettre les attributs enum inconnus de sa version. aapt2
# expose alors sans ambiguïté la valeur compilée Android
# (FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK = 0x2).
if ! grep -Eq 'android:foregroundServiceType="(mediaPlayback|2|0x0*2)"' <<<"$manifest_xml"; then
  manifest_tree=$($AAPT2 dump xmltree "$APK" --file AndroidManifest.xml)
  grep -Eq 'foregroundServiceType.*=0x0*2([[:space:]]|$)' <<<"$manifest_tree" || fail 'type foreground mediaPlayback absent'
fi
grep -Fq 'android:name="androidx.media3.session.MediaSessionService"' <<<"$manifest_xml" || fail 'intent-filter MediaSessionService absent'
grep -Fq 'android.permission.FOREGROUND_SERVICE"' <<<"$manifest_xml" || fail 'permission foreground service absente'
grep -Fq 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK' <<<"$manifest_xml" || fail 'permission mediaPlayback absente'
grep -Fq 'android.permission.POST_NOTIFICATIONS' <<<"$manifest_xml" || fail 'permission notification absente'
# Ces permissions ne correspondent à aucune fonction de Melodix et rendent
# l'APK inutilement suspect lors de l'installation.
for forbidden in RECORD_AUDIO ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE SYSTEM_ALERT_WINDOW; do
  if grep -Fq "android.permission.$forbidden" <<<"$manifest_xml"; then
    fail "permission Android inattendue: $forbidden"
  fi
done

echo
echo '=== ABI et bibliothèques natives ==='
mapfile -t actual_abis < <(sed -n 's#^lib/\([^/]*\)/[^/]*\.so$#\1#p' <<<"$entries" | sort -u)
((${#actual_abis[@]} > 0)) || fail 'aucune bibliothèque native dans APK'
printf 'ABI présentes: %s\n' "${actual_abis[*]}"

IFS=',' read -ra expected_abis <<<"$EXPECTED_ABIS"
for abi in "${expected_abis[@]}"; do
  printf '%s\n' "${actual_abis[@]}" | grep -Fxq "$abi" || fail "ABI attendue absente: $abi"
  count=$(grep -c "^lib/$abi/.*\.so$" <<<"$entries")
  ((count > 0)) || fail "aucune bibliothèque pour ABI $abi"
  printf '%s: %s bibliothèques\n' "$abi" "$count"
done
for abi in "${actual_abis[@]}"; do
  printf '%s\n' "${expected_abis[@]}" | grep -Fxq "$abi" || fail "ABI inattendue: $abi"
done

# Toutes les ABI du même APK universel doivent proposer le même ensemble de
# .so. Une différence signale souvent un module natif incomplet qui plantera au
# chargement sur une famille de processeurs seulement.
reference_abi=${expected_abis[0]}
reference=$(awk -F/ -v abi="$reference_abi" '$1 == "lib" && $2 == abi && $3 ~ /\.so$/ { print $3 }' <<<"$entries" | sort)
for abi in "${expected_abis[@]:1}"; do
  current=$(awk -F/ -v abi="$abi" '$1 == "lib" && $2 == abi && $3 ~ /\.so$/ { print $3 }' <<<"$entries" | sort)
  if ! diff -u <(printf '%s\n' "$reference") <(printf '%s\n' "$current"); then
    fail "ensemble de bibliothèques différent entre $reference_abi et $abi"
  fi
done

echo
echo '=== Alignement ZIP ==='
$ZIPALIGN -c -P 16 4 "$APK"

echo
echo '=== Signature et certificat ==='
signing=$($APKSIGNER verify --verbose --print-certs "$APK")
printf '%s\n' "$signing"
grep -Fq 'Verifies' <<<"$signing" || fail 'signature APK invalide'
grep -Eq 'Verified using v1 scheme.*: true' <<<"$signing" || fail 'signature v1 absente (requise pour minSdk 23)'
grep -Eq 'Verified using v2 scheme.*: true' <<<"$signing" || fail 'signature v2 absente'
cert_sha256=$(sed -nE 's/^(Signer #1|V3\.0 Signer): certificate SHA-256 digest: //p' <<<"$signing" | head -1 | tr '[:upper:]' '[:lower:]')
[[ "$cert_sha256" =~ ^[0-9a-f]{64}$ ]] || fail 'certificat signataire absent'
if [[ -n "$EXPECTED_CERT_SHA256" ]]; then
  expected_cert=$(tr '[:upper:]' '[:lower:]' <<<"$EXPECTED_CERT_SHA256")
  [[ "$cert_sha256" == "$expected_cert" ]] || fail "certificat inattendu: $cert_sha256"
fi

echo
echo 'APK_VALID=true'
