#!/bin/sh
# Installe et lance un APK sur l'émulateur déjà démarré par GitHub Actions.
# Ce script reste dans un seul processus : android-emulator-runner exécute chaque
# ligne de son option `script` dans un shell distinct.
set -u

APK=${1:-}
PACKAGE=com.souxch06.melodix
# Redirect URI Spotify CANONIQUE de l'application — source unique = workflow
# (.github/workflows/android-apk.yml, valeur déterministe). Le build embarque
# EXACTEMENT cette URI (vérifiée avant build et dans l'APK final) : les sondes
# deep-link OAuth de ce smoke l'utilisent donc telle quelle. L'ancienne URI de
# test historique comspotifytestsdk://callback (dashboard périmé) ne doit
# JAMAIS alimenter un build : elle produirait une erreur « redirect_uri: not
# matching configuration » au login physique. Le scheme natif melodix EST le
# scheme de ce redirect ; la route de seed interne (scénario B) reste hors
# chaîne OAuth Spotify.
SPOTIFY_REDIRECT='melodix://callback'
# Version attendue : source UNIQUE = app.config.js. Une constante en dur ici
# (ex. 45002) divergeait à chaque bump et ferait échouer le smoke alors que
# l'APK est correcte. `node` est disponible (Node 20). EXPECTED_VERSION_CODE
# reste une surcharge explicite.
if [ -z "${EXPECTED_VERSION_CODE:-}" ]; then
  EXPECTED_VERSION_CODE=$(node -p "require('./app.config.js').expo.android.versionCode" 2>/dev/null || true)
fi
[ -n "$EXPECTED_VERSION_CODE" ] || EXPECTED_VERSION_CODE=45003

fail() {
  # Les commandes de workflow GitHub doivent tenir sur une ligne.
  detail=$(printf '%s' "$1" | tr '\r\n' '  ' | sed 's/%/%25/g')
  echo "::error title=Test installation Android::$detail"
  exit 1
}

[ -n "$APK" ] || fail "chemin de l'APK absent"
[ -s "$APK" ] || fail "APK absent ou vide : $APK"
command -v adb >/dev/null 2>&1 || fail "adb est introuvable"

adb logcat -c || fail "impossible de vider logcat"

# L'installation propre démontre l'installabilité. La réinstallation démontre
# aussi que le certificat de signature reste cohérent pour une mise à jour.
#
# Les runners GitHub Actions manquent transitoirement de mémoire pendant le
# push/install (run 37532126463 : « fork failed: Out of memory Performing
# Push Install » sur un APK déjà validé par la run précédente). On retente
# donc les deux installations — SANS rien changer aux vérifications : un
# échec après 3 essais reste un échec de l'APK, pas du runner.
adb_install_retry() {
  _label=$1
  _flag=$2
  _attempt=1
  _out=""
  while [ "$_attempt" -le 3 ]; do
    _out=$(adb install --no-streaming $_flag "$APK" 2>&1) && {
      printf '%s' "$_out"
      return 0
    }
    if [ "$_attempt" -ge 3 ]; then
      printf '%s' "$_out"
      return 1
    fi
    echo "::warning title=Install Android::$_label — essai $_attempt échoué (mémoire transitoire de l'émulateur possible) : $(printf '%s' "$_out" | tr '\r\n' '  ' | sed 's/%/%25/g') — nouvel essai"
    sleep 10
    _attempt=$((_attempt + 1))
  done
}

CLEAN=$(adb_install_retry "installation propre" "") || \
  fail "installation propre refusée après 3 essais : $CLEAN"
echo "$CLEAN"
UPDATE=$(adb_install_retry "mise à jour" "-r") || \
  fail "mise à jour refusée après 3 essais : $UPDATE"
echo "$UPDATE"

PACKAGE_INFO=$(adb shell dumpsys package "$PACKAGE" 2>&1) || fail "dumpsys package impossible : $PACKAGE_INFO"
printf '%s\n' "$PACKAGE_INFO" | grep -Fq "versionCode=$EXPECTED_VERSION_CODE" || \
  fail "versionCode $EXPECTED_VERSION_CODE absente après installation"
# Android 13+ : valide que la permission runtime déclarée peut réellement être
# accordée. Le test Robolectric couvre ensuite la publication MediaStyle.
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS || \
  fail "permission POST_NOTIFICATIONS impossible à accorder"

adb shell am force-stop "$PACKAGE" || fail "force-stop impossible"
START=$(adb shell am start -W -n "$PACKAGE/.MainActivity" 2>&1) || fail "MainActivity non lançable : $START"
echo "$START"
printf '%s\n' "$START" | grep -Fq 'Status: ok' || \
  fail "ActivityManager n'a pas confirmé le lancement : $START"

sleep 8
PID=$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
if [ -z "$PID" ]; then
  adb logcat -d -v time | tail -300
  fail "le processus $PACKAGE s'est arrêté après installation"
fi

echo "Processus Melodix actif : pid=$PID"

# Sonde deep-link OAuth WARM : l'app est déjà vivante (étage d'accueil/
# connexion). Le callback melodix://callback?code=… (redirect CANONIQUE de
# l'app) est routé par l'intent-filter du manifest vers MainActivity
# (singleTask) ; en l'absence de flux OAuth en cours le runtime ne doit
# CRASHER ni naviguer sur une page inconnue (+native-intent retourne null
# pour ce lien). Code factice : JAMAIS échangé.
# L'URL doit être protégée pour le SHELL DE L'ÉMULATEUR : le '&' de la
# querystring serait sinon interprété comme opérateur d'arrière-plan.
WARM_DL=$(adb shell "am start -W -a android.intent.action.VIEW -d '${SPOTIFY_REDIRECT}?code=smoke&state=smoke' -p $PACKAGE" 2>&1) || \
  fail "deep-link OAuth warm non routable (intent-filter melodix://callback manquant) : $WARM_DL"
echo "$WARM_DL"
printf '%s\n' "$WARM_DL" | grep -Fq 'Status: ok' || \
  fail "ActivityManager n'a pas confirmé la route du deep-link OAuth warm"
sleep 5
WARM_PID=$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
[ -n "$WARM_PID" ] || fail "processus détruit après deep-link OAuth warm"
echo "::notice title=Deep-link OAuth (warm)::${SPOTIFY_REDIRECT} routé vers l'app vivante sans crash (pid=$WARM_PID)"

# ── HÔTE Spotify Web de PRODUCTION (V17) — breadcrumb logcat [MelodixSpotifyWeb] ──
# L'hôte de production est monté à la racine de l'app (hors Stack) : la WebView
# (hors écran) charge open.spotify.com et le runtime y gère handshake + bridge.
# La porte est OUVERTE en production (défaut de préférence + bootstrap).
# L'APK assembleRelease n'est pas debuggable (pas de run-as) : le breadcrumb
# console.log → logcat est la SEULE observabilité CI de cet hôte.
# CI = AUCUN compte Spotify : aucune tentative de lecture n'est engagée →
# ni `playback-confirmed` ni `playback-error` ne doivent apparaître ici ;
# l'absence de FAUX `playing` est re-vérifiée en fin de run (toute la durée).
# (Le prototype de diagnostic plus bas reste couvert séparément : il est un
# écran settings distinct de l'hôte de production.)
WEB_HOST_LOGCAT_FILE=$(mktemp /tmp/melodix-web-host.XXXXXX)
capture_web_host_lines() {
  # Snapshote les lignes [MelodixSpotifyWeb] dans le fichier de run :
  # logcat est vidé (adb logcat -c) entre les scénarios OAuth, sans ce
  # snapshot la vérification finale « faux playing » serait aveugle à la
  # première moitié du run.
  _hlines=$(adb logcat -d 2>/dev/null | grep -F '[MelodixSpotifyWeb]' || true)
  if [ -n "$_hlines" ]; then
    printf '%s\n' "$_hlines" >> "$WEB_HOST_LOGCAT_FILE"
  fi
}
capture_web_host_lines
# 1. MONTAGE de l'hôte production : REQUIS (porte ouverte en production).
# Émulateur CI lent : on laisse du temps au bundle + au montage (sondes).
_htries=0
while ! grep -Fq 'host-mounted' "$WEB_HOST_LOGCAT_FILE"; do
  [ "$_htries" -ge 3 ] && break
  sleep 5
  _htries=$((_htries + 1))
  capture_web_host_lines
done
grep -Fq 'host-mounted' "$WEB_HOST_LOGCAT_FILE" || \
  fail "hôte de production non monté (aucune ligne [MelodixSpotifyWeb] host-mounted en logcat après ~45 s de run)"
echo "::notice title=Hôte Spotify Web (production)::host-mounted confirmé en logcat — la WebView open.spotify.com (hors écran) est montée à la racine de l'app"
# 2. Résultat du HANDSHAKE : explicite et borné (le runtime rapporte TOUJOURS
# un code de l'enum contrôlée — prêt ou erreur nommée). Attendu sans compte.
_hdone=0
_htries=0
while [ "$_hdone" -eq 0 ]; do
  [ "$_htries" -ge 6 ] && break
  sleep 5
  _htries=$((_htries + 1))
  capture_web_host_lines
  if grep -Eq 'bridge_ready|probe_installed|bridge_timeout|network_error|http_error|web_player_inaccessible|navigation_blocked|renderer_destroyed|webview_reconnect_exhausted' "$WEB_HOST_LOGCAT_FILE"; then
    _hdone=1
  fi
done
if grep -Fq 'bridge_ready' "$WEB_HOST_LOGCAT_FILE"; then
  echo "::notice title=Handshake hôte production::bridge_ready — le pont page ↔ app est établi sur l'hôte de production"
elif grep -Eq 'bridge_timeout|network_error|http_error|web_player_inaccessible|navigation_blocked|renderer_destroyed|webview_reconnect_exhausted' "$WEB_HOST_LOGCAT_FILE"; then
  _hcodes=$(grep -Eo 'probe_installed|bridge_timeout|network_error|http_error|web_player_inaccessible|navigation_blocked|renderer_destroyed|webview_reconnect_exhausted' "$WEB_HOST_LOGCAT_FILE" | sort -u | tr '\n' ',' | sed 's/,$//')
  echo "::warning title=Handshake hôte production::handshake non prêt (codes: ${_hcodes:-inconnu}) — aucune capacité de lecture revendiquée (comportement honnête sans compte Spotify)"
  # V88 — la sonde PRÉCOCE tranche entre les deux causes possibles d'un
  # bridge_timeout : pont natif absent, ou injection tardive en échec.
  if printf '%s' "$_hcodes" | grep -q 'probe_installed'; then
    echo "::notice title=Sonde précoce (V88)::probe_installed REÇU — le pont natif existe dans le document et l'injection avant contenu a eu lieu ; la panne du handshake est donc dans l'injection TARDIVE"
  else
    echo "::notice title=Sonde précoce (V88)::probe_installed ABSENT — le pont natif n'a rien posté depuis le document ; la panne est en amont de l'injection"
  fi
else
  _observed=$(grep -F '[MelodixSpotifyWeb]' "$WEB_HOST_LOGCAT_FILE" | grep -Eo '\] [a-z0-9_-]+' | tr -d ']' | sort -u | tr '\n' ',' | sed 's/^, //;s/,$//')
  fail "aucun résultat explicite du handshake de l'hôte de production en logcat (ni bridge_ready ni code de diagnostic) — codes observés: ${_observed:-aucun}"
fi
# 3. Premier état publié ACCEPTÉ par le backend (pipeline page → app).
# Non bloquant : sans compte, la page peut n'accepter aucun état — mais si
# elle publie, le backend doit l'accepter (jamais d'état fantôme).
if grep -Fq 'bridge-state' "$WEB_HOST_LOGCAT_FILE"; then
  echo "::notice title=Bridge hôte production::bridge-state — un état publié par la page a été accepté par le backend (pipeline page → app prouvé)"
else
  echo "::warning title=Bridge hôte production::aucun état de page accepté observé (bridge-state) — sans compte Spotify la lecture réelle n'est pas démontrée en CI"
fi
# 4. Dès maintenant (avant toute interaction) : AUCUNE ligne de lecture.
if grep -Fq 'playback-confirmed' "$WEB_HOST_LOGCAT_FILE"; then
  fail "FAUX PLAYING : [MelodixSpotifyWeb] playback-confirmed présent en logcat alors qu'aucun compte Spotify et aucune interaction utilisateur n'existent"
fi

# Prototype Spotify Web isolé : ouvre la route de diagnostic par deep link,
# vérifie que la vraie vue Android est rendue, puis exerce arrière-plan/retour.
# Aucun compte, cookie, token ou contenu DOM Spotify n'est lu par ce smoke.
WEB_START=$(adb shell am start -W -a android.intent.action.VIEW \
  -d "melodix://settings/spotify-web-diagnostic" -p "$PACKAGE" 2>&1) || \
  fail "prototype Spotify Web non ouvrable : $WEB_START"
echo "$WEB_START"
# Laisse au chargement puis au timeout de handshake (8 s) le temps de conclure.
# Sonde par itérations : un dump unique après un délai fixe est un faux négatif
# classique sur émulateur CI lent (le dump peut précéder la fin de la
# transition de route). Aucun comportement d'app n'est impliqué.
# (V17 : la section hôte de production qui précède cette sonde laisse l'émulateur
# plus chargé — WebView open.spotify.com off-screen + attente du handshake — ce
# qui a fait dépasser la fenêtre de 60 s sur un runner lent, run 37810103366 :
# « écran de diagnostic Spotify Web absent après deep link (12 dumps) ». La
# fenêtre est donc portée à 80 s sans rien assouplir : l'écran doit EXISTER.)
# (V26.5, run 38059652388 : même famille sur un runner encore plus lent — le
# build testé était IDENTIQUE AU BIT PRÈS à celui du run vert 38057481568
# (arbres git d2907e0f, 33 min d'écart), le pont de production avait rendu son
# verdict honnête (bridge_timeout = warning non bloquant, déjà vu dans les runs
# verts) et seul ce sondage UI a expiré : 16 itérations × (5 s de sommeil +
# ~2,5 s de dump) ≈ 121 s mesurées sans que la navigation JS — affamée par le
# rendu logiciel swiftshader sur 2 cœurs — atteigne l'écran. La fenêtre passe à
# 24 itérations (~180 s au total) : le délai reste BORNE et l'assertion est
# inchangée — l'écran doit TOUJOURS EXISTER.)
# Détection durcie : les échecs de dump (uiautomator « could not get idle
# state » quand la fenêtre ne se stabilise jamais) ne sont plus avalés en
# /dev/null ; dumps réussis et échoués sont comptés séparément et le dernier
# message d'erreur est conservé pour le rapport de faille.
WEB_UI=""
DUMP_TRIES=0
DUMP_OK=0
DUMP_FAIL=0
LAST_DUMP_ERR=""
LAST_OK_UI=""
while [ "$DUMP_TRIES" -lt 24 ]; do
  sleep 5
  DUMP_TRIES=$(( DUMP_TRIES + 1 ))
  if ! DUMP_OUT=$(adb shell uiautomator dump /sdcard/melodix-web.xml 2>&1); then
    DUMP_FAIL=$(( DUMP_FAIL + 1 ))
    LAST_DUMP_ERR=$(printf '%s' "$DUMP_OUT" | tr '\r\n' '  ' | cut -c1-160)
    continue
  fi
  WEB_UI=$(adb shell cat /sdcard/melodix-web.xml 2>&1) || continue
  DUMP_OK=$(( DUMP_OK + 1 ))
  LAST_OK_UI="$WEB_UI"
  printf '%s\n' "$WEB_UI" | grep -Fq 'Prototype Spotify Web' && break
  WEB_UI=""
done
if [ -z "$WEB_UI" ]; then
  # Le fail() reste un échec ; la preuve est rendue lisible dans le log du
  # step pour distinguer, à la prochaine occurrence, « navigation en retard »
  # (fenêtre focalisée = MainActivity mais écran absent) de « UI jamais idle »
  # (dumps KO majoritaires) ou de « app morte » (pid absent).
  echo "--- diag écran diagnostic : tentatives=$DUMP_TRIES, dumps réussis=$DUMP_OK, dumps en échec=$DUMP_FAIL"
  if [ -n "$LAST_DUMP_ERR" ]; then
    echo "--- diag : dernière erreur uiautomator : $LAST_DUMP_ERR"
  fi
  echo "--- diag : focalisation : $(adb shell dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | tr '\r\n' '  ' | cut -c1-300)"
  echo "--- diag : pid : $(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$LAST_OK_UI" ]; then
    echo "--- diag : textes visibles du dernier dump réussi : $(printf '%s' "$LAST_OK_UI" | tr '<' '\n' | grep -oE 'text="[^"]+"' | grep -v 'text=""' | sort -u | head -25 | tr '\n' '|' | cut -c1-900)"
  fi
  echo "--- diag : fin de fil [MelodixSpotifyWeb] : $(adb logcat -d 2>/dev/null | grep -F '[MelodixSpotifyWeb]' | tail -12 | tr '\n' '|' | cut -c1-900)"
  fail "écran de diagnostic Spotify Web absent après deep link ($DUMP_TRIES dumps : $DUMP_OK réussis, $DUMP_FAIL en échec${LAST_DUMP_ERR:+; dernière erreur: $LAST_DUMP_ERR}) — voir lignes « diag » ci-dessus"
fi
# Le probe W3C doit produire un résultat explicite : handshake disponible ou
# timeout honnête. Si l'écran est apparu vite, le minuteur de handshake (8 s)
# peut encore être en cours : on le laisse conclure, sans jamais l'embellir.
BRIDGE_TRIES=0
while ! printf '%s\n' "$WEB_UI" | grep -Eq 'Bridge: (prêt|timeout)'; do
  BRIDGE_TRIES=$(( BRIDGE_TRIES + 1 ))
  [ "$BRIDGE_TRIES" -ge 5 ] && break
  sleep 5
  adb shell uiautomator dump /sdcard/melodix-web.xml >/dev/null 2>&1 || continue
  NEW_UI=$(adb shell cat /sdcard/melodix-web.xml 2>&1) || continue
  printf '%s\n' "$NEW_UI" | grep -Fq 'Prototype Spotify Web' && WEB_UI="$NEW_UI"
done
if printf '%s\n' "$WEB_UI" | grep -Fq 'Bridge: prêt'; then
  echo "Bridge WebView React Native prêt (probe navigator.mediaSession injecté)"
elif printf '%s\n' "$WEB_UI" | grep -Fq 'Bridge: timeout'; then
  echo "::warning title=Bridge Spotify Web indisponible::handshake WebView expiré ; aucune capacité de lecture revendiquée"
else
  fail "aucun résultat explicite du handshake Spotify Web (ready/timeout)"
fi
if printf '%s\n' "$WEB_UI" | grep -Fq 'Widevine: oui'; then
  echo "::notice title=Capacité DRM WebView::EME et Widevine déclarés disponibles par Android WebView"
elif printf '%s\n' "$WEB_UI" | grep -Fq 'Widevine: non'; then
  echo "::warning title=Capacité DRM WebView::Widevine indisponible pour la configuration audio EME testée"
else
  echo "::warning title=Capacité DRM WebView::résultat Widevine inconnu (probe non conclu)"
fi
# Indicateurs non bloquants du pont v2 : le smoke constate, ne simule rien.
if printf '%s\n' "$WEB_UI" | grep -Fq 'source: media-session'; then
  echo "::notice title=État réel du Web Player::la page a publié un état via navigator.mediaSession"
else
  echo "::warning title=État réel du Web Player::aucun état mediaSession publié (normal sans lecture réelle de la part d'un compte)"
fi
if printf '%s\n' "$WEB_UI" | grep -Fq 'titre=oui'; then
  echo "::notice title=Métadonnées MediaSession::titre publié par la page elle-même"
fi
if printf '%s\n' "$WEB_UI" | grep -Fq 'positionState: oui'; then
  echo "::notice title=positionState::durée/position exposées par la page via MediaSession"
fi
# Canal de commande réel : appui sur la sonde « Commande lecture » si elle est
# localisable, puis lecture du résultat affiché. Une réponse acceptée OU un
# refus honnête (no-authorized-execution-surface) prouve la corrélation
# request↔réponse sur l'appareil ; un résultat « expired » prouve que la
# commande est bien partie sur le canal avec minuteur réel. Deux tentatives
# (le premier appui peut tomber pendant une bascule de document). Non bloquant
# par conception.
tap_command_probe() {
  adb shell uiautomator dump /sdcard/melodix-cmd.xml >/dev/null 2>&1 || true
  local bounds coords x1 y1 x2 y2
  bounds=$(adb shell cat /sdcard/melodix-cmd.xml 2>/dev/null | tr '>' '\n' | grep -F 'Commande lecture' | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 || true)
  coords=$(printf '%s' "$bounds" | grep -oE '[0-9]+' | head -4 || true)
  x1=$(printf '%s\n' "$coords" | sed -n 1p); y1=$(printf '%s\n' "$coords" | sed -n 2p)
  x2=$(printf '%s\n' "$coords" | sed -n 3p); y2=$(printf '%s\n' "$coords" | sed -n 4p)
  if ! printf '%s%s%s%s' "$x1" "$y1" "$x2" "$y2" | grep -Eq '^[0-9]+$'; then
    return 1
  fi
  adb shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 )) || true
  # Au-delà de l'expiration de 5 s : le diagnostic « expired » est alors
  # observable si la page ne répond pas ; une réponse, elle, arrive en général
  # bien avant.
  sleep 7
  return 0
}
CMD_OUTCOME='introuvable'
for ATTEMPT in 1 2; do
  if ! tap_command_probe; then
    break
  fi
  adb shell uiautomator dump /sdcard/melodix-cmd2.xml >/dev/null 2>&1 || true
  CMD_UI=$(adb shell cat /sdcard/melodix-cmd2.xml 2>&1 || true)
  if printf '%s\n' "$CMD_UI" | grep -Fq 'command_accepted'; then
    CMD_OUTCOME='acceptee'
  elif printf '%s\n' "$CMD_UI" | grep -Fq 'no-authorized-execution-surface'; then
    CMD_OUTCOME='refus-page'
  elif printf '%s\n' "$CMD_UI" | grep -Fq 'expired'; then
    CMD_OUTCOME='expiree'
  elif printf '%s\n' "$CMD_UI" | grep -Fq 'command_unavailable'; then
    CMD_OUTCOME='non-distribuee'
  else
    CMD_OUTCOME='aucune-ligne'
  fi
  # Un résultat « pont non prêt » (non distribuable au moment de l'appui)
  # mérite une seconde chance après stabilisation du document.
  if [ "$CMD_OUTCOME" != 'non-distribuee' ]; then
    break
  fi
  sleep 5
done
case "$CMD_OUTCOME" in
  acceptee)
    echo "::notice title=Canal commande::commande acceptée par la page Web (corrélation requestId validée sur l'appareil)"
    ;;
  refus-page)
    echo "::notice title=Canal commande::refus honnête reçu de la page (no-authorized-execution-surface) : émission, corrélation et réponse fonctionnent ; exécution volontairement non simulée"
    ;;
  expiree)
    echo "::notice title=Canal commande::commande émise et corrélée, sans réponse de page dans le délai — le minuteur d'expiration réel fonctionne (la page ne doit pas répondre sans surface autorisée)"
    ;;
  non-distribuee)
    echo "::warning title=Canal commande::commande refusée avant émission (pont non prêt au moment de l'appui après 2 tentatives) — l'appui a bien atteint le bouton ; canal testé, non bloquant"
    ;;
  aucune-ligne)
    echo "::warning title=Canal commande::aucun résultat de commande lisible dans l'UI après appui — constat non bloquant"
    ;;
  *)
    echo "::warning title=Canal commande::sonde de commande introuvable dans le dump UI ; appui non testé (non bloquant)"
    ;;
esac
adb shell input keyevent KEYCODE_HOME || fail "prototype WebView impossible à mettre en arrière-plan"
sleep 2
WEB_RETURN=$(adb shell am start -W -n "$PACKAGE/.MainActivity" 2>&1) || \
  fail "retour au prototype WebView impossible : $WEB_RETURN"
echo "$WEB_RETURN"
sleep 2
WEB_PID=$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
[ -n "$WEB_PID" ] || fail "processus détruit après arrière-plan/retour WebView"
echo "Prototype Spotify Web rendu et survivant au cycle arrière-plan/retour (pid=$WEB_PID)"

# Smoke natif réel (pas Robolectric) : Android démarre le MediaSessionService,
# celui-ci doit respecter le contrat FGS, publier l'id 1001 sur le canal média,
# enregistrer une MediaSession, puis survivre au passage de l'Activity en fond.
# Cette simulation ne prétend pas charger un flux Audius : elle valide la
# portion service → notification → System UI qui manquait au smoke précédent.
SERVICE="$PACKAGE/expo.modules.melodixmedia.MelodixMediaService"
SERVICE_START=$(adb shell am start-foreground-service -n "$SERVICE" 2>&1) || \
  fail "MediaSessionService non démarrable : $SERVICE_START"
echo "$SERVICE_START"
sleep 3
SERVICES=$(adb shell dumpsys activity services "$PACKAGE" 2>&1) || \
  fail "dumpsys services impossible : $SERVICES"
printf '%s\n' "$SERVICES" | grep -Fq 'MelodixMediaService' || \
  fail "MelodixMediaService absent des services actifs"
NOTIFICATIONS=$(adb shell dumpsys notification --noredact 2>&1) || \
  fail "dumpsys notification impossible : $NOTIFICATIONS"
printf '%s\n' "$NOTIFICATIONS" | grep -Fq "$PACKAGE" || \
  fail "aucune notification active attribuée à Melodix"
printf '%s\n' "$NOTIFICATIONS" | grep -Fq 'melodix_media' || \
  fail "canal melodix_media absent de la notification système"
SESSIONS=$(adb shell dumpsys media_session 2>&1) || \
  fail "dumpsys media_session impossible : $SESSIONS"
printf '%s\n' "$SESSIONS" | grep -Fq "$PACKAGE" || \
  fail "MediaSession Melodix absente du système"

adb shell input keyevent KEYCODE_HOME || fail "mise en arrière-plan impossible"
sleep 2
SERVICES_BG=$(adb shell dumpsys activity services "$PACKAGE" 2>&1) || \
  fail "dumpsys services en arrière-plan impossible : $SERVICES_BG"
printf '%s\n' "$SERVICES_BG" | grep -Fq 'MelodixMediaService' || \
  fail "service média détruit au passage en arrière-plan"
NOTIFICATIONS_BG=$(adb shell dumpsys notification --noredact 2>&1) || \
  fail "dumpsys notification en arrière-plan impossible : $NOTIFICATIONS_BG"
printf '%s\n' "$NOTIFICATIONS_BG" | grep -Fq 'melodix_media' || \
  fail "notification média disparue en arrière-plan"

# ── Sonde deep-link OAuth COLD START — SCÉNARIO A : callback SANS
# transaction PKCE persistée (vault propre) ──
# L'app est tuée, puis Android la relance PAR le callback
# `melodix://callback?code=…` (redirect canonique de l'app).
# Le runtime JS doit :
#   1. démarrer via l'intent-filter du manifest ;
#   2. DÉMARRER EN MODE LOCAL (V29 : la garde n'envoie plus jamais vers
#      /login — le flux OAuth vit dans SpotifyAuthProvider monté à la
#      RACINE, donc le callback est lu quel que soit l'écran affiché) ;
#   3. lire l'URL initiale et ÉMETTRE la séquence [SpotifyAuth] du cold
#      start (callback:received → code:received → callback:error …).
# Code factice : en CI il n'y a AUCUNE transaction PKCE persistée ni compte
# Spotify — le hook DOIT classifier l'échec proprement (jamais de faux login,
# jamais de crash). C'est la VRAIE chaîne deep-link → hook, testée sur
# Android 14 réel (émulateur), sans prétendre à un login Spotify.
adb shell am force-stop "$PACKAGE" || fail "force-stop avant sonde OAuth cold impossible"
adb logcat -c || fail "impossible de vider logcat avant sonde OAuth cold"
# Même protection de l'URL pour le shell de l'émulateur ( '&' ).
COLD_DL=$(adb shell "am start -W -a android.intent.action.VIEW -d '${SPOTIFY_REDIRECT}?code=smoke&state=smoke' -p $PACKAGE" 2>&1) || \
  fail "cold start via deep-link OAuth impossible : $COLD_DL"
echo "$COLD_DL"
printf '%s\n' "$COLD_DL" | grep -Fq 'Status: ok' || \
  fail "cold start via deep-link OAuth non confirmé par ActivityManager"
# Sonde par itérations (émulateur CI lent) : le bundle JS + la garde de
# démarrage + le montage du hook prennent un temps variable.
AUTH_TRACE=""
DL_TRIES=0
while [ "$DL_TRIES" -lt 12 ]; do
  sleep 5
  DL_TRIES=$(( DL_TRIES + 1 ))
  AUTH_TRACE=$(adb logcat -d 2>/dev/null | grep -F '[SpotifyAuth]' || true)
  [ -n "$AUTH_TRACE" ] && break
done
if [ -z "$AUTH_TRACE" ]; then
  adb logcat -d -v time | tail -300
  fail "callback OAuth cold non traité par le runtime JS (aucune ligne [SpotifyAuth] après $DL_TRIES sondes)"
fi
printf '%s\n' "$AUTH_TRACE" | grep -Fq 'callback:received cold-start' || \
  fail "cold start OAuth non identifié par le hook : $AUTH_TRACE"
printf '%s\n' "$AUTH_TRACE" | grep -Fq 'code:received cold-start' || \
  fail "code OAuth absent du callback cold identifié : $AUTH_TRACE"
printf '%s\n' "$AUTH_TRACE" | grep -Fq 'callback:error cold-start-no-verifier' || \
  fail "callback cold sans transaction PKCE non classé proprement : $AUTH_TRACE"
COLD_PID=$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
[ -n "$COLD_PID" ] || fail "processus détruit après cold start OAuth"
echo "::notice title=Deep-link OAuth (cold start, scénario A)::callback SANS transaction persistée traité par le runtime JS — séquence [SpotifyAuth] complète, échec classé proprement sans compte (pid=$COLD_PID)"

# ── Sonde deep-link OAuth COLD START — SCÉNARIO B : callback AVEC
# transaction PKCE persistée (fixture smoke, build de test uniquement) ──
# La fixture EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1 (voir SPOTIFY-DIAG 6/7)
# permet de construire le cas complet SANS compte Spotify :
#   1. cold launch via la route de seed interne
#      melodix://oauth-smoke-seed?state=smoke-state (fixture de test, HORS
#      chaîne OAuth Spotify — le callback Spotify est melodix://callback) →
#      le hook ÉCRIT une transaction PKCE DÉTERMINISTE dans SecureStore
#      (verifier=smoke-verifier, state=smoke-state, redirect=redirect
#      effectif du build = melodix://callback, canonique) — c'est du
#      wiring, PAS un faux login ;
#   2. le processus est tué (force-stop) → le runtime est recréé ;
#   3. Android relance l'app par melodix://callback?code=…&state=smoke-state
#      (state ET redirect identiques au seed) ;
#   4. le hook DOIT retrouver la transaction (state/redirect/fraîcheur OK)
#      et lancer l'échange avec le verifier PERSISTÉ :
#      callback:received → code:received → cold-start:transaction-present
#      → cold-start:transaction-valid → cold-start:verifier-restored
#      → token_exchange:start.
# L'échange lui-même est REJETÉ par Spotify (code factice) : l'échec est
# classé, jamais de faux login. Ce scénario prouve le wiring cold-start
# avec transaction persistée, pas un login Spotify réel.
adb shell am force-stop "$PACKAGE" || fail "force-stop avant seed smoke impossible"
adb logcat -c || fail "impossible de vider logcat avant seed smoke"
SMOKE_SEED_DL=$(adb shell "am start -W -a android.intent.action.VIEW -d 'melodix://oauth-smoke-seed?state=smoke-state' -p $PACKAGE" 2>&1) || \
  fail "cold start via seed smoke impossible : $SMOKE_SEED_DL"
echo "$SMOKE_SEED_DL"
printf '%s\n' "$SMOKE_SEED_DL" | grep -Fq 'Status: ok' || \
  fail "seed smoke non confirmée par ActivityManager"
SEED_OK=""
DL_TRIES_B=0
while [ "$DL_TRIES_B" -lt 12 ]; do
  sleep 5
  DL_TRIES_B=$(( DL_TRIES_B + 1 ))
  if adb logcat -d 2>/dev/null | grep -Fq 'smoke:seeded'; then
    SEED_OK=1
    break
  fi
done
[ -n "$SEED_OK" ] || {
  adb logcat -d -v time | tail -300
  fail "seed smoke non traitée (aucune trace smoke:seeded après 60 s) — fixture inactive ou hook non monté"
}
# Destruction du runtime : processus tué, relance PAR le callback (state
# identique au seed). SecureStore (Keystore Android) survit au kill.
adb shell am force-stop "$PACKAGE" || fail "force-stop avant callback smoke B impossible"
adb logcat -c || fail "impossible de vider logcat avant callback smoke B"
SMOKE_CB_DL=$(adb shell "am start -W -a android.intent.action.VIEW -d '${SPOTIFY_REDIRECT}?code=smoke-code&state=smoke-state' -p $PACKAGE" 2>&1) || \
  fail "cold start via callback smoke B impossible : $SMOKE_CB_DL"
echo "$SMOKE_CB_DL"
printf '%s\n' "$SMOKE_CB_DL" | grep -Fq 'Status: ok' || \
  fail "callback smoke B non confirmé par ActivityManager"
AUTH_TRACE_B=""
DL_TRIES_B=0
while [ "$DL_TRIES_B" -lt 12 ]; do
  sleep 5
  DL_TRIES_B=$(( DL_TRIES_B + 1 ))
  AUTH_TRACE_B=$(adb logcat -d 2>/dev/null | grep -F '[SpotifyAuth]' || true)
  printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'token_exchange:start' && break
done
printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'callback:received cold-start' || \
  fail "cold-start B : callback non identifié par le hook : $AUTH_TRACE_B"
printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'cold-start:transaction-present' || \
  fail "cold-start B : transaction persistée NON retrouvée (SecureStore/Keystore inopérant ou seed perdue) : $AUTH_TRACE_B"
printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'cold-start:transaction-valid' || \
  fail "cold-start B : transaction non acceptée (state/redirect/fraîcheur) : $AUTH_TRACE_B"
printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'cold-start:verifier-restored' || \
  fail "cold-start B : verifier persisté non restauré : $AUTH_TRACE_B"
printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'token_exchange:start' || \
  fail "cold-start B : échange non lancé avec la transaction persistée : $AUTH_TRACE_B"
# AVEC une transaction valide, les erreurs d'absence/décalage sont INTERDITES.
if printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'cold-start-no-verifier'; then
  fail "cold-start B : erreur no-verifier malgré une transaction persistée valide — wiring cassé : $AUTH_TRACE_B"
fi
if printf '%s\n' "$AUTH_TRACE_B" | grep -Fq 'cold-start-mismatch'; then
  fail "cold-start B : erreur mismatch malgré state/redirect identiques au seed — wiring cassé : $AUTH_TRACE_B"
fi
# ORDRE de la séquence : numéros de ligne réels dans le log (grep -n).
SMOKE_LOG="$(mktemp /tmp/melodix-smoke-b.XXXXXX)"
printf '%s\n' "$AUTH_TRACE_B" > "$SMOKE_LOG"
line_of() { grep -Fn "$1" "$SMOKE_LOG" | head -1 | cut -d: -f1 || true; }
LB1=$(line_of 'callback:received cold-start')
LB2=$(line_of 'code:received cold-start')
LB3=$(line_of 'cold-start:transaction-present')
LB4=$(line_of 'cold-start:transaction-valid')
LB5=$(line_of 'cold-start:verifier-restored')
LB6=$(line_of 'token_exchange:start')
rm -f "$SMOKE_LOG"
if [ -z "$LB1" ] || [ -z "$LB2" ] || [ -z "$LB3" ] || [ -z "$LB4" ] || [ -z "$LB5" ] || [ -z "$LB6" ]; then
  fail "cold-start B : séquence incomplète (lignes=$LB1,$LB2,$LB3,$LB4,$LB5,$LB6) : $AUTH_TRACE_B"
fi
ORDER_OK=1
[ "$LB1" -lt "$LB2" ] || ORDER_OK=0
[ "$LB2" -lt "$LB3" ] || ORDER_OK=0
[ "$LB3" -lt "$LB4" ] || ORDER_OK=0
[ "$LB4" -lt "$LB5" ] || ORDER_OK=0
[ "$LB5" -lt "$LB6" ] || ORDER_OK=0
[ "$ORDER_OK" -eq 1 ] || \
  fail "cold-start B : séquence hors ordre (lignes=$LB1,$LB2,$LB3,$LB4,$LB5,$LB6)"
SMOKE_B_PID=$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
[ -n "$SMOKE_B_PID" ] || fail "processus détruit après cold start B"
echo "::notice title=Deep-link OAuth (cold start, scénario B)::callback AVEC transaction PKCE persistée — transaction retrouvée en SecureStore, verifier restauré, échange lancé (token_exchange:start), séquence ordonnée vérifiée en logcat (pid=$SMOKE_B_PID) — wiring, PAS un login Spotify"
echo "::warning title=Login Spotify physique::PHYSICAL SPOTIFY LOGIN NOT TESTABLE IN CI — aucun compte Spotify utilisable dans GitHub Actions ; les scénarios A/B prouvent la chaîne deep-link → hook → classification/wiring cold-start, pas un login Spotify réel"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- Deep-link OAuth : warm (app vivante) ; cold A (callback SANS tx → cold-start-no-verifier) ; cold B (callback AVEC tx persistée → verifier restauré → token_exchange:start, séquence ordonnée) ; login Spotify réel NON testable en CI (pas de compte)" >> "$GITHUB_STEP_SUMMARY"
fi

# ── V34 — TENTATIVE RÉELLE DE LECTURE (fixture playback-smoke) ──
# Deep-link melodix://playback-smoke en COLD START : la fixture (active dans
# ce build de test via EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1) exécute une
# recherche RÉELLE puis une VRAIE tentative de lecture par le moteur expo-av
# sur l'émulateur. Verdict classé en logcat [PlaybackSmoke] — JAMAIS de faux
# vert : « started » exige que le moteur confirme playing ET s'y maintienne.
# Distinction honnête : l'émulateur tourne en -noaudio ; le verdict porte sur
# l'état RÉEL du moteur audio (chargement + démarrage confirmés), pas sur une
# sortie sonore. Un échec de flux (ex. refus du serveur de contenu depuis
# l'IP du runner) est rapporté classé, pas masqué.
adb shell am force-stop "$PACKAGE" || fail "force-stop avant playback-smoke impossible"
adb logcat -c || fail "impossible de vider logcat avant playback-smoke"
PLAYBACK_DL=$(adb shell "am start -W -a android.intent.action.VIEW -d 'melodix://playback-smoke?src=auto' -p $PACKAGE" 2>&1) || \
  fail "deep-link playback-smoke non lançable : $PLAYBACK_DL"
printf '%s\n' "$PLAYBACK_DL" | grep -Fq 'Status: ok' || \
  fail "ActivityManager n'a pas confirmé le deep-link playback-smoke"
PLAYBACK_TRACE=""
_pbtries=0
while [ "$_pbtries" -lt 18 ]; do
  sleep 5
  _pbtries=$((_pbtries + 1))
  PLAYBACK_TRACE=$(adb logcat -d 2>/dev/null | grep -F '[PlaybackSmoke]' || true)
  printf '%s\n' "$PLAYBACK_TRACE" | grep -Fq 'verdict:' && break
done
printf '%s\n' "$PLAYBACK_TRACE" | grep -Fq 'route:received' || \
  fail "fixture playback-smoke non déclenchée (aucune route:received après ~90 s) — hook non monté ou flag fixture absent du build"
printf '%s\n' "$PLAYBACK_TRACE" | grep -Fq 'search:settled' || \
  fail "playback-smoke : la recherche réelle n'a pas soldé dans le budget : $PLAYBACK_TRACE"
PB_VERDICT=$(printf '%s\n' "$PLAYBACK_TRACE" | grep -Eo 'verdict:[a-z-]+' | head -1)
[ -n "$PB_VERDICT" ] || fail "playback-smoke : aucun verdict dans le budget : $PLAYBACK_TRACE"
PB_STATUS=$(printf '%s\n' "$PLAYBACK_TRACE" | grep -Eo 'status=[a-z]+' | tail -1 || true)
case "$PB_VERDICT" in
  verdict:started)
    echo "::notice title=Lecture réelle (émulateur Android)::tentative de lecture RÉELLE aboutie — recherche réelle soldée, piste jouable sélectionnée, moteur expo-av a confirmé playing et s'y est maintenu (sortie audio coupée sur l'émulateur : verdict sur l'état moteur, pas sur le son)"
    ;;
  verdict:error|verdict:unavailable|verdict:timeout)
    echo "::warning title=Lecture réelle (émulateur Android)::tentative RÉELLE engagée ($PB_VERDICT ${PB_STATUS:-}) — échec classé, mesure honnête ; à croiser avec le diagnostic flux du banc réseau (restriction possible des IP du runner)"
    ;;
  verdict:no-playable-track)
    echo "::warning title=Lecture réelle (émulateur Android)::recherche réelle soldée SANS piste jouable sur l'émulateur — aucune tentative de lecture engagée"
    ;;
  *)
    fail "playback-smoke : verdict inattendu ($PB_VERDICT) : $PLAYBACK_TRACE"
    ;;
esac
# V35 — PHASE 2 (verdict started uniquement) : changement de piste +
# commandes pause/reprise vérifiés APRÈS la lecture confirmée. Mesures sur
# l'état moteur réel (émulateur -noaudio) ; tout échec est rapporté classé.
PB_PHASE2=""
if [ "$PB_VERDICT" = "verdict:started" ]; then
  _p2tries=0
  while [ "$_p2tries" -lt 12 ]; do
    sleep 5
    _p2tries=$((_p2tries + 1))
    PLAYBACK_TRACE=$(adb logcat -d 2>/dev/null | grep -F '[PlaybackSmoke]' || true)
    if printf '%s\n' "$PLAYBACK_TRACE" | grep -Eq 'phase2:summary|controls:(resume ok|resume timeout|pause timeout)'; then
      break
    fi
  done
  PB_TC=$(printf '%s\n' "$PLAYBACK_TRACE" | grep -Eo 'track-change:[a-z-]+' | tail -1 || true)
  PB_PAUSE=$(printf '%s\n' "$PLAYBACK_TRACE" | grep -Eo 'controls:pause (ok|timeout)' | tail -1 || true)
  PB_RESUME=$(printf '%s\n' "$PLAYBACK_TRACE" | grep -Eo 'controls:resume (ok|timeout)' | tail -1 || true)
  case "$PB_TC" in
    track-change:started)
      echo "::notice title=Changement de piste (émulateur)::changement de piste RÉEL vérifié — lecture confirmée par le moteur sur une deuxième piste issue de la recherche réelle (état moteur, pas de sortie sonore)"
      ;;
    track-change:skipped)
      echo "::notice title=Changement de piste (émulateur)::sauté — une seule piste jouable dans la recherche réelle (mesure impossible, jamais inventée ; verdict principal inchangé)"
      ;;
    track-change:error|track-change:unavailable|track-change:timeout)
      echo "::warning title=Changement de piste (émulateur)::tentative RÉELLE engagée ($PB_TC) — échec classé, mesure honnête"
      ;;
    *)
      echo "::warning title=Changement de piste (émulateur)::non observé dans le budget (trace: ${PB_TC:-absente})"
      ;;
  esac
  PB_SUMMARY=$(printf '%s\n' "$PLAYBACK_TRACE" | grep -Eo 'phase2:summary [^|]*' | tail -1 || true)
  if [ "$PB_PAUSE" = "controls:pause ok" ] && [ "$PB_RESUME" = "controls:resume ok" ]; then
    echo "::notice title=Commandes lecteur (émulateur)::pause puis reprise CONFIRMÉES par l'état moteur réel après lecture démarrée (état moteur, pas de sortie sonore)"
  else
    _PB_DUMP=$(printf '%s\n' "$PLAYBACK_TRACE" | tail -25 | tr '\n' '|')
    echo "::warning title=Commandes lecteur (émulateur)::pause/reprise non confirmées dans le budget (pause=${PB_PAUSE:-absente} reprise=${PB_RESUME:-absente} ${PB_SUMMARY:-resume-absent}) — mesure honnête sur émulateur -noaudio — trace fixture: ${_PB_DUMP}"
  fi
  PB_PHASE2=" · changement de piste ${PB_TC:-non observé} · pause ${PB_PAUSE:-non observée} · reprise ${PB_RESUME:-non observée}"
fi
PLAYBACK_PID=$(adb shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r' || true)
[ -n "$PLAYBACK_PID" ] || fail "processus détruit après playback-smoke"
echo "::notice title=Playback smoke (cold start)::séquence recherche réelle → sélection piste jouable → tentative de lecture par le moteur expo-av exécutée sans crash (pid=$PLAYBACK_PID) — verdict : $PB_VERDICT"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- Playback smoke : recherche réelle + tentative de lecture réelle par le moteur expo-av — verdict $PB_VERDICT$PB_PHASE2 (émulateur -noaudio : état moteur, pas de sortie sonore)" >> "$GITHUB_STEP_SUMMARY"
fi

# ── VÉRIFICATION FINALE FAUX PLAYING (V17) — TOUT LE RUN ──
# Snapshot initial (début de run) + logcat courant : sans compte Spotify
# (CI), aucune tentative de lecture n'est engagée et la ligne
# `playback-confirmed` est INTERDITE. Sa présence prouverait un faux
# `playing` — un `playing` moteur sans publication RÉELLE de la page
# (mission V17 : interdit). L'absence est l'attente honnête : la lecture
# réelle Spotify Web exige un compte + geste utilisateur dans la page.
capture_web_host_lines
if grep -Fq 'playback-confirmed' "$WEB_HOST_LOGCAT_FILE"; then
  fail "FAUX PLAYING : [MelodixSpotifyWeb] playback-confirmed présent en logcat (run complet) sans compte Spotify — playback non réellement publié par la page"
fi
if grep -Fq 'playback-error' "$WEB_HOST_LOGCAT_FILE"; then
  _ecodes=$(grep -F 'playback-error' "$WEB_HOST_LOGCAT_FILE" | grep -Eo 'code=[a-z0-9-]+' | sort -u | tr '\n' ',' | sed 's/,$//')
  echo "::notice title=Fake playing (run complet)::aucun playback-confirmed (attendu sans compte Spotify) — une tentative réelle a été engagée, verdict honnête documenté : ${_ecodes:-code inconnu}"
else
  echo "::notice title=Fake playing (run complet)::aucun playback-confirmed ni playback-error en logcat : sans compte Spotify, aucune tentative de lecture n'a été engagée — aucun faux playing ; la lecture RÉELLE Spotify Web reste NON DÉMONTRÉE en CI (test physique : non effectué)"
fi
echo "::warning title=Lecture Spotify Web (CI)::PLAYBACK SPOTIFY WEB RÉEL NON TESTABLE IN CI — pas de compte Spotify ni d'interaction utilisateur possible dans la page ; la CI valide l'hôte production (montage/handshake/bridge) et l'absence de faux playing, pas une lecture Spotify"
rm -f "$WEB_HOST_LOGCAT_FILE"
echo "::notice title=Installation Android réelle::installation + HÔTE Spotify Web production (montage/handshake/bridge, aucun faux playing) + prototype WebView + cycle arrière-plan/retour + service foreground + MediaSession + notification + deep-link OAuth (A et B) réussis sur Android 14 x86_64 (pid=$SMOKE_B_PID)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- Android 14 : installation, HÔTE Spotify Web production (host-mounted, handshake explicite, bridge, AUCUN faux playing), écran prototype, cycle arrière-plan/retour, FGS média, MediaSession et notification système vérifiés" >> "$GITHUB_STEP_SUMMARY"
  echo "- Spotify Web : lecture RÉELLE non testable en CI (pas de compte) — chaîne hôte production observée par logcat ; TEST PHYSIQUE : NON EFFECTUÉ" >> "$GITHUB_STEP_SUMMARY"
fi
