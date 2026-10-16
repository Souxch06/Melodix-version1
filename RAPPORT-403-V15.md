# Rapport — Pourquoi « HTTP 403 — accès refusé » sans le message exact : diagnostic explicite du corps 403 (v15, 4.5.0-test.20)

**Date** : 2026-10-08 — **Branche** : `arena/fcdae8c6-melodix`
**HEAD avant** : `20c41ee` (code V14 = `501a21b`) — **HEAD après** : `d1dc71b`
**CI** : run `37772231920` SUCCESS (16 min 49 s)
**Version** : `4.5.0-test.20` / versionCode `45020`
**Test physique déclencheur (APK test.19)** : `Compte Spotify indisponible` puis
**`HTTP 403 — accès refusé`** — le message exact attendu par V14 n'apparaît pas.

---

## 1. Cause exacte — pourquoi l'application affichait seulement « accès refusé »

**Le message Spotify n'est PAS perdu ni écrasé dans le code Melodix.** La
chaîne complète a été suivie fichier par fichier, valeur par valeur :

| Étape                  | Fichier (ligne de code)                                                     | Ce qui se passe                                                                         |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Réponse 403         | `services/spotify/apiClient.ts` — branche `!response.ok`                    | Lecture du corps, capture `error.message` → `SpotifyApiError.spotifyMessage` (sanitisé) |
| 2. Passage au contexte | `api/spotify/me.ts` — `getCurrentUser`                                      | **Aucun `try/catch`, aucun wrap** : l'erreur `SpotifyApiError` passe telle quelle       |
| 3. Classification      | `context/UserDataContext.tsx` — `classifyVerificationFailure`, cas `'http'` | `message: error.spotifyMessage.trim() \|\| undefined` — transmise telle quelle          |
| 4. Rendu               | `context/spotifyIdentity.ts` — `describeSpotifyVerificationFailure`         | Message sûr présent → `HTTP 403 — <message>` ; sinon libellé localisé                   |
| 5. Écran               | `app/(tabs)/_layout.tsx` + `screens/SettingsScreen.tsx`                     | Appel direct du descriptor avec le dictionnaire complet                                 |

**Preuve par les tests** : avec une réponse
`{"error":{"status":403,"message":"User not approved for app"}}`, le message
arrive bien jusqu'à l'UI (`HTTP 403 — User not approved for app`) — test
automatique dédié, vert.

**La cause du libellé générique est donc amont de l'UI, du côté du parse** :
l'ancien parser ne retenait le message que si le corps était **exactement**
`{ "error": { "message": "<string>" } }`. Dans tous les autres cas —
**corps vide, JSON sans `error.message`, réponse non JSON (ex. page HTML d'un
CDN/filtre), message masqué** — `spotifyMessage` restait `''` et l'UI repliait
**silencieusement** sur « HTTP 403 — accès refusé ». C'est cette
sous-information qui est corrigée : ces cas sont désormais conservés
(classification du corps + Content-Type) et affichés **explicitement**.

D'où deux lectures possibles du résultat test.19, toutes deux désormais
tranchables sur téléphone :

1. **Spotify renvoie un 403 sans message exploitable** (le plus probable) →
   test.20 affichera la forme exacte : corps vide / JSON sans error.message /
   non JSON + Content-Type ;
2. **L'APK installée était en réalité la test.18** (sans le code V14) → test.20
   ne pourrait pas afficher l'ancien libellé seul sans la mention explicite
   « aucun message détaillé fourni ».

## 2. Spotify — qualifié : code, parsing, propagation, ou externe ?

- **Propagation UI** : correcte (preuve par test §1) — le message disponible
  arrive jusqu'à l'écran.
- **Code Melodix / comportement auth** : non modifié, non concerné (403 sans
  refresh, sans conversion 401, session conservée — invariants testés).
- **Parsing** : c'était LE point faible — trop strict et silencieux. Corrigé :
  le code conserve désormais ce qu'il peut distinguer (message exact / corps
  vide / JSON sans message / non JSON / masqué + Content-Type), sans jamais
  conserver ni afficher le contenu du corps.
- **Réponse réelle Spotify / configuration externe** : si le test.20 affiche
  l'une des mentions « aucun message détaillé », alors **le 403 vient de
  Spotify (infrastructure ou configuration de l'app), pas du parsing
  Melodix**. Les causes externes restant possibles, à l'ordre de probabilité :
  1. **Compte non approuvé — app en Development Mode** : le compte doit
     figurer dans « Users and Access » du Dashboard Spotify. Spotify renvoie
     classiquement `{"error":{"status":403,"message":"User not approved for
app"}}` dans ce cas → test.20 l'affichera alors tel quel.
  2. **Refus au niveau edge/WAF/CDN** (corps vide ou HTML) : blocage de
     l'application au niveau infrastructure Spotify (app bloquée/désactivée,
     mode dev, quota) — le Content-Type affiché (`text/html`…) le confirmera.
  3. **Panne backend Spotify sur apps dev-mode** (fil communautaire août 2026)
     → réessayer plus tard.

> **Ce rapport ne dit PAS « corrigé » au sens Spotify** : la cause externe du
> 403 ne peut être tranchée que depuis le téléphone (APK test.20) ou le
> Dashboard Spotify. Ce qui est corrigé et prouvé par tests : l'application ne
> masque plus **aucune** information disponible sur la réponse 403.

## 3. Fichiers modifiés (rôle de chacun)

| Fichier                                                   | Rôle de la modification                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/spotify/apiClient.ts`                           | Nouveau type `SpotifyApiHttpDiagnostics` (`bodyShape` : `empty`/`json`/`non-json` + `contentType` sanitisé) ; `SpotifyApiError` enrichi (5ᵉ paramètre optionnel, rétrocompatible) ; capture du 403/5xx par `response.text()` : classification du corps (vide / JSON avec `error.message` / JSON avec `error` string / JSON sans message / non JSON) + Content-Type ; corps **jamais** stocké ni loggé ; log `api.http` enrichi (forme + content-type) |
| `context/spotifyIdentity.ts`                              | Variante http du diagnostic : `detail?` (`empty`/`json`/`non-json`/`redacted`) + `contentType?` ; descriptor : message sûr → `HTTP N — <message>` ; sinon `detail` → **`HTTP N — Spotify n'a fourni aucun message détaillé (<forme>) (Content-Type: …)`** ; sinon libellé localisé (repli conservé seulement si aucune info disponible)                                                                                                               |
| `context/UserDataContext.tsx`                             | `classifyVerificationFailure` (cas http) : transmet `detail` (forme du corps, ou `redacted` si message masqué) + `contentType` — jamais le corps                                                                                                                                                                                                                                                                                                      |
| `data/fr-fr.ts` / `data/en-gb.ts`                         | Nouvelle clé `spotifyVerifyErrorNoDetail(status, detail)` (4 formes × 2 langues)                                                                                                                                                                                                                                                                                                                                                                      |
| `services/spotify/useSpotifyAuth.ts`                      | Log `/v1/me success/error: error (…)` enrichi : `corps=<forme> content-type=<valeur>` (diagnostic devLog, déjà protégé contre les valeurs sensibles)                                                                                                                                                                                                                                                                                                  |
| `services/spotify/__tests__/apiClient.unit.test.ts`       | Stubs 403 passés à `text()` ; +4 tests : JSON sans message, corps vide, HTML non JSON (+zéro fuite du contenu de page), format `{ "error": "code" }`                                                                                                                                                                                                                                                                                                  |
| `context/__tests__/spotifyIdentity.unit.test.ts`          | +6 tests : les 4 `detail` rendues explicitement (jamais « accès refusé » masquant), Content-Type sûr joint / sensible omis, message gagne sur detail, 5xx sans message                                                                                                                                                                                                                                                                                |
| `context/__tests__/UserDataContext.unit.test.tsx`         | +2 tests : cas 10 (403 corps vide → `detail empty`, session conservée, Réessayer → succès), cas 11 (403 message `<redacted>` → `detail redacted`, zéro fuite)                                                                                                                                                                                                                                                                                         |
| `app/(tabs)/__tests__/layoutSessionRestore.unit.test.tsx` | +2 tests UI : carte affiche « aucun message détaillé (corps de réponse vide) » + Content-Type, et « réponse non JSON » + Content-Type HTML — **sans** « accès refusé »                                                                                                                                                                                                                                                                                |
| `screens/__tests__/SettingsScreen.unit.test.tsx`          | +1 test UI : sous-titre du compte affiche le même diagnostic explicite                                                                                                                                                                                                                                                                                                                                                                                |
| Version                                                   | `4.5.0-test.20` / `45020` en 8 endroits (5 fichiers)                                                                                                                                                                                                                                                                                                                                                                                                  |

**INTOUCHÉS (vérifié par diff : 0 ligne)** : `app/(tabs)/_layout.tsx`,
`screens/SettingsScreen.tsx` (bouton **Réessayer**), `services/spotify/session.ts`
(échange PKCE / SecureStore / refresh), `services/spotify/authConfig.ts`
(**Client ID**, **redirect URI**, scopes), Spotify Web Player, MediaSession.

## 4. Tests (résultats exacts, avant CI)

- **Jest** : `152 passed, 14 skipped` — **2032 passed, 0 failed, 14 skipped**
  (+16 tests nouveaux, tous vert).
- **TypeScript** (`tsc --noEmit`) : 0 erreur.
- **ESLint** : 0 erreur.
- **Prettier** : fichiers modifiés propres (`--write` + `--check`).
- **Android build + APK smoke** : exécutés par la CI GitHub Actions
  (`android-apk.yml` : build release, signature, vérification version 45020,
  invariants redirect `melodix://callback`, inspection APK, smoke) — résultat
  dans §Git.

Tests clés du diagnostic 403 :

| Test                                                                         | Garantie                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiClient` — 403 + message                                                  | `{"error":{"status":403,"message":"User not approved for app"}}` → `SpotifyApiError.spotifyMessage` conservé, **zéro appel `accounts.spotify.com`** (pas de refresh), session non supprimée, zéro token dans l'erreur |
| `apiClient` — 403 JSON sans message / corps vide / HTML / `{"error":"code"}` | `spotifyMessage` = `''` le cas échéant + `httpDiagnostics` = forme exacte + Content-Type ; contenu HTML **jamais** stocké/logué/affiché                                                                               |
| `spotifyIdentity`                                                            | 403 sans message + `detail` → « Spotify n'a fourni aucun message détaillé (…) » ; Content-Type sensible → omis ; message présent → message (pas de double info)                                                       |
| `UserDataContext`                                                            | 403 corps vide → `{http, 403, detail:'empty'}`, `clearSession` **non** appelé, Réessayer → 2ᵉ `/me` → succès ; `<redacted>` → `detail:'redacted'`                                                                     |
| `layout` / `SettingsScreen`                                                  | L'écran d'erreur et le sous-titre du compte affichent le diagnostic explicite, **sans** « accès refusé » masquant, zéro `undefined`, zéro valeur sensible                                                             |

## 5. Git

- **SHA HEAD avant** : `20c41ee` (V14 : code `501a21b` + rapport `20c41ee`)
- **SHA final** : `d1dc71b` (commit code + version + rapport)
- **Branche** : `arena/fcdae8c6-melodix` — **PR** : #6
- **CI** : run **`37772231920` SUCCESS** (16 min 49 s) — gates version 45020,
  invariants redirect `melodix://callback`, build release, signature,
  inspection APK, **smoke**
- **APK** : artefact CI **`Melodix-v4.5.0-test.20-d1dc71b.apk`** (Actions →
  run 37772231920 → artefacts)
- Invariants vérifiés avant commit : `melodix://callback` canonique intact,
  Client ID `7c5af4cd…` absent du diff, bouton Réessayer inchangé

## 6. TEST PHYSIQUE : NON EFFECTUÉ — matériel/compte indisponible

Aucune prétention de test physique. Protocole sur téléphone avec l'APK
**`Melodix-v4.5.0-test.20-d1dc71b.apk`** (artefact CI du run 37772231920) :

| Affichage dans l'app                                                           | Signification                                                                            | Action                                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP 403 — User not approved for app` (ou autre message lisible)              | **Message Spotify réel** → cause identifiable directement                                | Si « User not approved for app » : ajouter l'e-mail du compte dans « Users and Access » du Dashboard (app en dev mode) → ré-ouvrir l'app |
| `HTTP 403 — Spotify n'a fourni aucun message détaillé (corps de réponse vide)` | Refus 403 **sans corps** → couche edge/WAF/CDN Spotify (blocage infra de l'app ou panne) | 403 **externe** confirmé : vérifier l'état de l'app au Dashboard (bloquée ? dev mode ?) puis réessayer plus tard                         |
| `… (réponse JSON sans message d'erreur)`                                       | L'API Spotify a répondu en JSON mais sans message                                        | 403 **externe** : à analyser avec Spotify (support/communauté)                                                                           |
| `… (réponse non JSON)` + `Content-Type: text/html`                             | Le 403 vient d'une **page HTML** (CDN/filtre), pas de l'API                              | 403 **externe** confirmé (edge) : idem                                                                                                   |
| `HTTP 403 — accès refusé` (libellé générique seul)                             | Aucune information disponible                                                            | Vérifier que l'APK installée est bien la **test.20** (version visible dans Paramètres)                                                   |

**Limites honnêtes** : le Dashboard Spotify et le compte Spotify de
l'utilisateur ne sont pas accessibles depuis l'environnement de travail — le
contenu réel du corps 403 (et donc la cause externe exacte) n'est lisible que
depuis l'APK test.20 sur le téléphone ou depuis le Dashboard.
