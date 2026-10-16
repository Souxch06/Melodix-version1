# Rapport — « Compte Spotify indisponible » : chaîne `/v1/me` + refresh + bouton Réessayer (v13, 4.5.0-test.18)

**Date** : 2026-10-08 — **Branche** : `arena/fcdae8c6-melodix` — **Base** : `da298f5`
**Commit** : `af730d3` — **Version** : `4.5.0-test.18` / versionCode `45018`

---

## 1. Cause exacte — pourquoi « Réessayer » ne faisait rien

Le bouton **tirait bien** (Pressable réel → `reloadUserData()` → `GET /v1/me`).
Le problème était structurel, en 4 points :

1. **Aucun changement visible pendant la tentative** : `sessionStatus` restait
   `'spotify-unverified'` du début à la fin — le layout re-rendait la même
   `ErrorCard`, pixel pour pixel. Aucune transition `loading`.
2. **Les échecs étaient avalés** : le `catch` de `reloadUserData` faisait
   `console.warn` + `setStatus('spotify-unverified')` — le même état qu'avant.
   Aucun diagnostic n'était montré. Sur téléphone : pression → écran identique
   → « absolument rien ne se passe ».
3. **État bloqué permanent en cas d'échec définitif** : si le refresh token
   est refusé (`invalid_grant` — token expiré/révoqué) ou absent,
   `getValidAccessToken` renvoyait `null` → `unauthenticated` → `catch` →
   même état. La session morte n'était **jamais** nettoyée et la reconnexion
   **jamais** demandée : chaque « Réessayer » rejouait la même séquence
   perdante, indéfiniment. C'est l'état « session enregistrée + profil
   indisponible » qui emperrait toute nouvelle tentative.
4. **Hang possible sans fin** : `requestToken` (POST
   `accounts.spotify.com/api/token`) n'avait **aucun timeout** — une connexion
   qui plante (ni réponse, ni reset) laissait la promesse suspendue
   indéfiniment : bouton mort pour toujours, sans aucune erreur.

De plus, l'échec transitoire du refresh (429/5xx/réseau au token endpoint)
était aplati en `null` et donc **méclassé** comme « session morte ».

## 2. Correction — fichiers réellement modifiés

| Fichier                          | Changement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/spotify/session.ts`    | Timeout durci **15 s** sur `requestToken` (AbortController + race, classé `network` transitoire) ; refresh **classifié** avec RAE : `refreshAccessTokenClassified()` exporté (définitif `refused`/`no-refresh-token`/`no-session` vs transitoire `429`/`5xx`/`réseau`/`timeout`/`réponse illisible`) ; `getValidAccessToken` reconstruit dessus (signature conservée) ; `RefreshResult` + variante `no-session`                                                                                                                               |
| `services/spotify/apiClient.ts`  | Acquisition initiale classée (transitoire → erreur retryable, session conservée ; définitif → `unauthenticated` + détail sûr `code · HTTP N`) ; sur **401** : invalidation de l'access token (le 401 arrive même si le token n'est pas expiré localement : révocation/rotation) + **UNE** refresh RAE classée puis **UNE** retry ; **2ᵉ 401 après refresh réussi** → `http` 401 **retryable** (le refresh token vient d'être validé : session conservée, reconnexion forcée évitée) — au plus 1 refresh + 1 retry par appel, jamais de boucle |
| `context/UserDataContext.tsx`    | Vérification **unique** partagée boot + réessai (`verifySpotifyIdentity`) ; nouveau statut **`spotify-verifying`** (changement visible + anti double-clic : 2ᵉ clic ignoré) ; échec **définitif** → `signOut()` : credentials invalides purgés + état `local` (redirection `/login` = nouvelle connexion demandée) ; échec **transitoire** → `spotify-unverified` + **diagnostic structuré sûr** ; le bouton est objectivement non décoratif                                                                                                  |
| `context/spotifyIdentity.ts`     | `spotify-verifying` (plan `restoring`, compte comme session stockée) ; type `SpotifyVerificationFailure` ; `describeSpotifyVerificationFailure` (traducteur localisé : 401/403/429/5xx/réseau/réponse invalide)                                                                                                                                                                                                                                                                                                                               |
| `app/(tabs)/_layout.tsx`         | `spotify-verifying` → écran neutre (l'erreur disparaît pendant la tentative, plus de bouton → double clic impossible) ; `spotify-unverified` → cause sûre affichée dans la carte                                                                                                                                                                                                                                                                                                                                                              |
| `screens/SettingsScreen.tsx`     | Libellé « Vérification de ton compte Spotify… » + diagnostic dans le sous-titre, ligne Réessayer masquée pendant la tentative                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `data/fr-fr.ts`, `data/en-gb.ts` | 7 clés × 2 (`HTTP 401 — access token invalide ou expiré`, `HTTP 403 — accès refusé`, `HTTP 429 — trop de requêtes`, `Erreur Spotify (HTTP N) — erreur temporaire`, `Réseau indisponible`, `Réponse Spotify invalide`, générique)                                                                                                                                                                                                                                                                                                              |
| Version                          | `4.5.0-test.18` / `45018` en 6 endroits (vérifié ligne par ligne)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 3. Spotify — le chemin réel `/v1/me → 401 → refresh → /v1/me`

Cette logique était **partiellement présente** (401 → refresh ×1 → retry dans
l'apiClient) mais aveugle (transitoire/définitif aplatis en `null`) et sans
timeout. Après correction, la chaîne complète est :

```
GET /v1/me (Bearer access token)
 ├─ 200 → profil vérifié → session 'spotify'
 ├─ 401 → POST /api/token (grant_type=refresh_token + client_id, PKCE-compatible,
 │        SANS client secret) → accès invalidé d'abord, UNE refresh RAE :
 │   ├─ 200 + access_token → nouveau token sauvegardé (SecureStore,
 │   │  expiration mise à jour, refresh token conservé si Spotify n'en
 │   │  renvoie pas un neuf) → GET /v1/me rejoué → 200 → 'spotify'
 │   ├─ 4xx (invalid_grant/invalid_client…) → DÉFINITIF : session purgée,
 │   │  redirection /login (nouvelle connexion demandée, AUCUNE boucle)
 │   └─ 429/5xx/réseau/timeout → TRANSITOIRE : session CONSERVÉE,
 │      erreur retryable affichée → « Réessayer » retente
 ├─ 429 → attente Retry-After (borne 30 s) + retry silencieuse (×2)
 ├─ 403 → erreur explicite, session conservée si exploitable
 ├─ 5xx → erreur temporaire, réessayer
 └─ réseau → « Réseau indisponible », réessayer
```

Access token : TTL ~1 h géré par `expiresAtMs` (marge 60 s) ; refresh token :
longue durée, conservé quand Spotify n'en renvoie pas un nouveau.

## 4. Invariants conservés (vérifiés)

- Client ID `7c5af4cd…` (défaut `app.config.js`, aucune saisie possible) ;
- `melodix://callback` (4 occurrences intactes) ; Authorization Code + PKCE
  (S256) ; SecureStore ; refresh token ; scopes ; flux normal du login ;
- **Aucun** `client_secret`, aucun input Client ID, aucun cookie, aucun
  endpoint privé ; jamais affiché : access token, refresh token,
  `code_verifier`, Client Secret, cookies, headers `Authorization`.

## 5. Tests automatiques (résultats exacts)

| Gate                        | Résultat                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jest (local, `--runInBand`) | **2000 passed / 0 failed / 14 skipped** — 152 suites (base 1968 → **+32**)                                                                                                                                                                                                                                                                                           |
| Cas mission — context       | 7/7 : transition visible `unverified → verifying → success` ; 429 → session conservée + diagnostic ; réseau → `Réessayer` relance réellement `/me` (2 appels) ; `invalid_grant` → credentials purgés + `local` + aucune boucle (boot et réessai) ; double clic → 1 seule requête en vol ; sécurité → jamais token/`refresh_token`/`code_verifier`/header/`undefined` |
| Cas mission — apiClient     | 4/4 : 401 + refresh refusé → `unauthenticated` + détail sûr (jamais de token) ; 401 + refresh réseau → `network` session conservée ; 401 + refresh 429 → `rate-limited` ; 401 + refresh 503 → `network` transitoire                                                                                                                                                  |
| Cas mission — session       | 6/6 : refresh classifié (pas expiré → sans réseau ; refusé → définitif, session non corrompue ; 500 → transitoire ; réussi → persisté, ancien refresh conservé ; RAE 2 concurrents → 1 requête) + **timeout anti-hang** (connexion plantée → `network` après 15 s, abort demandé, pas de hang)                                                                       |
| Cas mission — écrans        | layout : `verifying` → plus de bouton (anti double-clic), diagnostic dans la carte (401/réseau), corps intact sans cause ; Settings : libellé vérification + diagnostic, pas de bouton pendant l'essai, `onPress` → vérification réelle (tests préexistants conservés)                                                                                               |
| Test existant ajusté        | « 2ᵉ 401 après refresh » : le refresh token étant validé, l'erreur est désormais `http` 401 retryable (session conservée) au lieu de forcer la reconnexion — justifié en commentaire de test                                                                                                                                                                         |
| TypeScript                  | `tsc --noEmit` : **0 erreur**                                                                                                                                                                                                                                                                                                                                        |
| ESLint                      | `npm run lint` : **0 erreur**                                                                                                                                                                                                                                                                                                                                        |
| Prettier                    | `npm run prettier:check` : **clean**                                                                                                                                                                                                                                                                                                                                 |
| CI Android (GitHub Actions) | **run `37741083970` — SUCCESS** (16 min 26 s, commit `af730d3`) : build EAS, versionName `4.5.0-test.18`/versionCode `45018`, package `com.souxch06.melodix`, canaux `melodix://callback`, invariants (aucun secret, PKCE, `melodix://callback`, aucun input Client ID), smoke Android (boot + deep link + diagnostics)                                              |
| Référence APK               | **`Melodix-v4.5.0-test.18-af730d3.apk`** (47 006 414 octets) — télécharger depuis l'artefact du run CI (l'API sandbox ne permet pas de calculer son SHA-256 ici)                                                                                                                                                                                                     |

## 6. Git

- **Ancien HEAD** : `da298f5` (vérifié, branché dessus directement)
- **Commit créé** : `af730d3` (21 fichiers, +1111/−185)
- **HEAD final** : `af730d3` (+ commit docs de ce rapport)
- **Branche** : `arena/fcdae8c6-melodix` — **push effectué**
- **État du worktree** : clean (après commit)

## 7. Validation physique

**FONCTIONNEL** (réellement implémenté et couvert par les tests ci-dessus)

- Bouton « Réessayer » → état visible `Vérification…` → `GET /v1/me` réel →
  `spotify` (succès) ou `spotify-unverified` + **cause lisible** (échec).
- `/v1/me → 401 → refresh PKCE → /v1/me` (une refresh + une retry par
  appel, RAE anti double-refresh, timeout anti-hang 15 s).
- Refresh refusé (`invalid_grant`…) → purge des credentials + retour écran de
  connexion (nouvelle connexion demandée, aucune boucle).
- 429/5xx/réseau → session conservée, message temporaire, réessai effectif.
- Double clic → une seule requête en vol.
- Diagnostic jamais sensible (garde champ par champ + tests).

**TESTÉ AUTOMATIQUEMENT** : tout ce qui est listé au §5 (2000 tests + CI
verte + smoke Android du workflow).

**TESTÉ PHYSIQUEMENT** : _rien dans Arena_ — aucun appareil réel, aucun compte
Spotify dans le sandbox.

**NON TESTÉ** (exige un vrai téléphone + compte) :

- le login physique complet jusqu'au compte affiché ;
- la re-vérification réelle après expiration d'un access token en conditions
  réelles ;
- le comportement réel si le refresh token est refusé par Spotify (le chemin
  code + tests est prêt : purge + reconnexion) ;
- la lisibilité du diagnostic sur l'écran du téléphone (le protocole de test
  est au §8).

**TEST PHYSIQUE : NON EFFECTUÉ — matériel/compte indisponible** (l'utilisateur
teste sur son téléphone).

## 8. Protocole de test sur le téléphone (avec l'APK test.18)

1. Installer `Melodix-v4.5.0-test.18-af730d3.apk` → « Continuer avec
   Spotify » → login → retour auto `melodix://callback` ;
2. Si « Compte Spotify indisponible » apparaît : lire la **cause affichée**
   (nouveau) — `Réseau indisponible` / `HTTP 401 — access token invalide ou
expiré` / `HTTP 429…` / `HTTP 403…` / `Erreur Spotify (HTTP 5xx)…` /
   `Réponse Spotify invalide` ;
3. Appuyer sur **Réessayer** : l'écran doit passer à un écran sombre
   « Vérification… » (changement visible = le bouton n'est plus décoratif) ;
4. Résultat : compte affiché (succès) ou la même carte avec la cause mise à
   jour (échec transitoire) ; si le refresh token est mort → retour
   automatique à l'écran de connexion (nouveau login requis) ;
5. Laisser l'app ~1 h (expiration de l'access token) puis relancer /
   réessayer : la vérification doit réussir **sans** nouveau login (refresh
   token).

---

_Rapport précédent : `RAPPORT-MODE-DIAGNOSTIC-OAUTH-V12.md`_
