# Rapport Mission V42 — Diagnostic ciblé des problèmes réels de Melodix

**Dépôt** : `Souxch06/Melodix`
**Branche** : `arena/5ef0ee6a-melodix` — **PR #9 : OUVERTE, non fusionnée**
**Version** : `4.5.0-test.34` (versionCode `45034`)
**Date** : 2026-10-12

---

## 1. État réel du dépôt vérifié avant toute modification

| Contrôle                      | Résultat mesuré                                                |
| ----------------------------- | -------------------------------------------------------------- |
| Branche                       | `arena/5ef0ee6a-melodix`                                       |
| HEAD à l'ouverture            | `4cd7553c…` — **PAS le SHA annoncé**                           |
| Tête distante de la PR        | `778a0676ac1019f50759b1aaeed42f69ef119875` (= SHA annoncé V41) |
| `main` distante               | `fceab85950b069edcb65ed718a8ffd419a1bc785` — **inchangée**     |
| PR #9                         | `OPEN`, `mergedAt = jamais`, base `main`                       |
| Dernier run APK sur `778a067` | `38237537848` — succès                                         |

**Constat important** : l'environnement de travail avait été réinitialisé.
Le HEAD local était revenu au commit de base et tout le travail V30→V41
apparaissait comme modifications non commitées. J'ai donc, **avant toute
action** :

1. récupéré la référence distante (`git fetch origin arena/5ef0ee6a-melodix`) ;
2. vérifié que le worktree était **identique à l'octet près** à la tête
   distante : `git diff --name-only origin/…` → **0 fichier différent** ;
3. seulement alors réaligné HEAD/index par `git reset --mixed` (déplace HEAD
   et l'index, **ne touche aucun fichier du worktree**).

Résultat : HEAD = `778a067`, worktree propre, **aucune perte, aucun reset
destructif**. Le SHA annoncé n'était effectivement plus le HEAD local — la
consigne de ne pas le supposer était justifiée.

---

## 2. Problème réellement corrigé (unique) : les diagnostics 403 n'atteignaient pas logcat

### Défaut démontré

`apiClient.ts` collecte pour chaque 403 un jeu de diagnostics conçu
explicitement pour identifier **qui** refuse :

- `bodyShape` — `empty` / `json` / `non-json` ;
- `contentType` — en-tête sanitisé ;
- `finalUrl`, `statusText` ;
- `headers` — allowlist explicite (`server`, `via`, `x-cache`, `cf-ray`,
  `cf-cache-status`, `www-authenticate`, `x-request-id`) ;
- `attempts` — persistance à travers le retry borné.

Ces valeurs sont ensuite confiées à `spotifyLog('api.http', …)`. Or la
whitelist `ALLOWED_DETAIL_KEYS` de `devLog.ts` ne contenait **aucune** de ces
clés, et `formatDetails` supprime silencieusement toute clé non listée.

**Preuve par exécution** (extraction de la whitelist réelle du module, avant
correctif) :

```
status       -> CONSIGNÉ
endpoint     -> CONSIGNÉ
cause        -> CONSIGNÉ
bodyShape    -> SILENCIEUSEMENT PERDU
contentType  -> SILENCIEUSEMENT PERDU
finalUrl     -> SILENCIEUSEMENT PERDU
headers      -> SILENCIEUSEMENT PERDU
attempts     -> SILENCIEUSEMENT PERDU
```

Conséquence réelle : le seul canal lisible sans interface fonctionnelle —
logcat — ne permettait **pas** de trancher entre un refus de l'API Spotify
(corps JSON avec message) et un refus d'une couche réseau intermédiaire
(corps non JSON, `server: envoy`, `via: … edgeproxy`), alors que le code
collectait ces champs dans ce but précis. Le contrat écrit du module
(« il est consigné sanitisé ») était violé.

Portée exacte, mesurée : l'UI (`useSpotifyAuth.ts` l.457-530) et le rapport de
diagnostic (`diagnosticReport.ts` l.564-573) recevaient bien ces champs via
l'objet d'erreur — **la perte ne touchait que logcat**.

### Correctif (limité au défaut)

1. Ajout des 6 clés de diagnostic 403 à la whitelist. Elles sont déjà bornées
   et sanitisées à la source ; les en-têtes proviennent d'une allowlist
   excluant `Authorization`, `Set-Cookie` et les cookies.
2. **Durcissement** : nouvelle fonction `scrubValue` appliquant la garde
   sensible à **chaque** chaîne réellement émise, y compris imbriquée dans
   `headers`. Un appelant futur qui oublierait de sanitisé une valeur ne peut
   plus faire passer un secret.

Aucun contournement des restrictions Spotify, aucun identifiant tiers, aucun
mode invité, aucun accès non documenté.

### Preuve que le correctif est nécessaire

Les 4 tests de régression ont été exécutés **avec le fichier d'origine
restauré** (`git checkout -- services/spotify/devLog.ts`) :

```
AVANT  : 3 échecs / 22 succès  (25 tests)
APRÈS  : 0 échec  / 25 succès
```

---

## 3. Ce qui a été audité sans défaut démontré (aucune modification)

| Domaine                                                         | Vérifications effectuées                                                                                                                                                                                                                                                   | Verdict  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| PKCE / échange du code / session                                | `authConfig.ts`, `session.ts` (refresh + garde anti-écrasement), `useSpotifyAuth.ts` (double livraison de callback, state, PKCE cold-start)                                                                                                                                | Conforme |
| Non-divulgation des secrets                                     | 139 sites d'appel de `spotifyLog`/`spotifyDiag`/`spotifyAuthTrace`/`spotifyConfigLine` inspectés : aucun ne transmet de valeur brute de token, code, verifier ou state (booléens et constantes uniquement) ; garde `sensitivePattern` + bornage                            | Conforme |
| Distinction refus / réseau / proxy                              | `network-blocked` (403 corps non JSON = couche intermédiaire) vs `profile-forbidden` (403 corps JSON ou vide = configuration) ; `me:network` pour l'injoignable ; session **conservée**, jamais de purge sur 403, jamais de re-refresh                                     | Conforme |
| Permission notification Android 13+                             | `ensureNotificationPermissionRequested` réellement appelée (l.272, l.316) ; natif renvoie `true` (accordée/SDK<33), `false` (demande lancée), `null` (pas d'activité → JS réessaie) ; polling 30 s puis `refreshLastProjection` pour afficher la notification après accord | Conforme |
| Désynchronisation UI ↔ PlayerContext ↔ player ↔ MediaSession | Projection `mediaBridge` : signature de dédup incluant `isPlaying`, verrou anti-boot (aucune activation sans `playing` réel), anti-spam sur ticks 500 ms                                                                                                                   | Conforme |
| Pause / focus audio                                             | Règle V38 (`buffering` jamais vrai une fois `playing` confirmé) + fenêtre anti-tick V37 (`TRANSPORT_CONFIRM_GRACE_MS`) ; interruption de focus reflétée via ticks natifs                                                                                                   | Conforme |
| Changement de piste / file                                      | `advanceAuto` (une avance par `didJustFinish`/token), `getOrderedIndices`, source de vérité unique                                                                                                                                                                         | Conforme |
| Catalogue ≠ flux lisible                                        | `trackResolver` : ordre strict Audius→YouTube, `matched`/`no-match`/`error` distingués ; sur `error` **rien** n'est écrit en cache négatif (pas de 30 jours d'indisponibilité pour une panne) ; re-cascade sur flux mort ; badge provider = qui joue réellement            | Conforme |
| Limites de résultats                                            | **Aucune augmentation** : aucune mesure nouvelle ne démontre un gain utile (V41 : YouTube 25→40 n'avait produit aucun gain mesurable)                                                                                                                                      | Inchangé |

Conformément à la consigne, **aucun commit artificiel** n'a été créé pour ces
domaines : le seul commit est celui du défaut démontré.

---

## 4. Tests exécutés et résultats

| Vérification                                                                               | Type                      | Résultat                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npx jest` suite complète                                                                  | automatisé **simulé**     | **2 516 passés / 0 échec** (14 en ligne ignorés) — 2 512 avant + 4 nouveaux                                             |
| `services/spotify` + `player` + `mediaBridge` + `melodix-media` (baseline avant correctif) | automatisé simulé         | 505/505                                                                                                                 |
| Tests de régression devLog AVANT correctif                                                 | automatisé simulé         | 3 échecs (preuve du défaut)                                                                                             |
| Tests de régression devLog APRÈS correctif                                                 | automatisé simulé         | 25/25                                                                                                                   |
| `npx tsc --noEmit`                                                                         | automatisé                | 0 erreur                                                                                                                |
| `npm run lint`                                                                             | automatisé                | 0 erreur (1 avertissement **préexistant** dans `app/(tabs)/__tests__/layoutSessionRestore.unit.test.tsx`, sans rapport) |
| `npx prettier --check`                                                                     | automatisé                | propre                                                                                                                  |
| CI : TypeScript/ESLint/Prettier                                                            | CI run `38277460546`      | succès                                                                                                                  |
| CI : Tests JavaScript / React Native                                                       | CI                        | succès                                                                                                                  |
| CI : Tests Kotlin module média (Robolectric)                                               | CI                        | succès                                                                                                                  |
| CI : compilation + signature + vérification de version                                     | CI                        | succès                                                                                                                  |
| CI : installation et lancement sur émulateur Android 14                                    | **émulateur**, `-noaudio` | succès                                                                                                                  |
| Lecture/pause/notification **réelles** sur téléphone                                       | —                         | **NON VÉRIFIÉ**                                                                                                         |
| Connexion Spotify réelle                                                                   | —                         | **NON VÉRIFIÉ**                                                                                                         |

**Aucune de ces vérifications ne prouve un comportement sonore réel.** Les
tests sont simulés (moteurs mockés) ou sur émulateur sans audio : ils
établissent des états et des appels, jamais un son entendu.

---

## 5. Livraison

| Élément             | Valeur vérifiée                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- |
| Commit du correctif | `41af6ab`                                                                          |
| Run APK             | `38277460546` — **SUCCÈS** (toutes étapes vertes, émulateur inclus)                |
| APK                 | `Melodix-v4.5.0-test.34-41af6ab.apk`                                               |
| Artifact            | id `11760049594`, 47 098 693 octets                                                |
| Version interne     | versionCode `45034`, versionName `4.5.0-test.34`                                   |
| sha256              | `b73acb62d47e4e0769d4f6af018f37939875dbfbe9fdddc63c3dd18135bd1592`                 |
| Lien                | https://github.com/Souxch06/Melodix/actions/runs/38277460546/artifacts/11760049594 |

---

## 6. Actions manuelles encore nécessaires pour Spotify

Le 403 sur `/v1/me` **n'a pas de cause démontrée côté code**. Les causes
possibles sont externes et se vérifient uniquement dans le tableau de bord
Spotify :

1. **Utilisateurs autorisés** — Developer Dashboard → votre application →
   _Users and Access_ : le compte utilisé doit y être explicitement ajouté.
   En mode développement, tout compte non listé reçoit un 403.
2. **Limite de 5 utilisateurs** — le mode développement n'autorise que 5
   comptes au maximum ; au-delà, l'ajout est refusé.
3. **Premium du propriétaire** — en mode développement, le propriétaire de
   l'application doit disposer d'un abonnement Premium **actif** ; s'il a
   expiré, l'accès API est refusé.
4. **Statut de l'application** — vérifier qu'elle n'est pas en état
   _suspended_ et que le _Redirect URI_ déclaré est exactement
   `melodix://callback`.
5. **Quota** — jusqu'à 25 Client ID par compte depuis le 2026-07-23, à quota
   partagé ; un dépassement produit des 429 `QUOTA_EXCEEDED` (pas des 403).
6. **Réseau** — si le 403 a un corps **non JSON**, l'application le classe
   `network-blocked` : c'est une couche intermédiaire (proxy/CDN/filtre), pas
   Spotify. À retester sur un autre réseau (partage de connexion mobile).

Grâce au correctif de cette mission, la ligne logcat
`[Spotify OAuth] api.http — {"status":403,…}` indique désormais la forme du
corps, le Content-Type et les en-têtes : c'est la donnée qui permet de
distinguer les cas 1-3 (corps JSON, configuration) du cas 6 (corps non JSON,
réseau).

**Aucun contournement n'est proposé ni implémenté** : pas d'identifiant
tiers, pas d'extraction de token, pas de mode invité, pas d'API interne non
documentée.

---

## 7. Vérifications exigeant impérativement un téléphone physique

1. **Son réellement entendu** — aucun test de cet environnement ne peut
   l'établir (émulateur CI en `-noaudio`).
2. **Pause/reprise physiques** — le défaut V38 est corrigé et testé en
   simulation, mais n'a **jamais** été revalidé sur appareil depuis.
3. **Notification et écran verrouillé** — accord runtime de
   `POST_NOTIFICATIONS` (Android 13+), rendu OEM, commandes de la
   notification agissant sur la lecture.
4. **Lecture en arrière-plan réelle** — survie au verrouillage, perte et
   retour du focus audio, débranchement de casque, retrait des applications
   récentes.
5. **Connexion Spotify de bout en bout** — avec un compte autorisé et le
   Premium du propriétaire actif.
6. **Lecture YouTube sur réseau résidentiel** — le runner CI reçoit des
   réponses anti-bot ; cela ne prouve rien pour un téléphone.

---

## 8. Problèmes non résolus

| Problème                                 | Nature                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 403 Spotify `/v1/me`                     | **Externe** — configuration du tableau de bord Spotify (voir §6). Aucune correction code possible.                  |
| Pause / notification / son sur téléphone | Non revalidés physiquement depuis les correctifs V38 ; exigent un appareil.                                         |
| Instabilité de l'étape émulateur CI      | Observée en V41 (run `38233405808`) ; non reproduite dans cette mission (run vert). Sans cause de code démontrable. |

---

**PR #9 non fusionnée. `main` inchangée. Aucun reset destructif.**
