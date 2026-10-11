# RAPPORT DE MISSION V36 — STABILISATION FINALE ET LIVRAISON MELODIX

**Date :** 11 octobre 2026 (livraison prévue le dimanche 18 octobre 2026)
**Branche :** `arena/5ef0ee6a-melodix` — PR #9 ouverte, aucun merge, `main` intact.
**Positionnement :** V36 consolide V34/V35 sans ré-audit général ni réécriture : aucun défaut reproductible n'ayant été démontré cette mission, **aucune ligne de code applicatif n'a été modifiée**. Tout le contenu ci-dessous est de la vérification exécutable et de la livraison.

---

## 1. Sécurisation GitHub (vérifiée)

| Élément                 | État vérifié                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                  | `fceab85950b069edcb65ed718a8ffd419a1bc785` — inchangé                                                                                                     |
| PR #9                   | OUVERTE, tête `fe4d7d91798cef6b26bae5b08f4c2acfe314fe2a`, MERGEABLE, base `main`                                                                          |
| Commit applicatif V35   | `15610714863d475ea42d89106dc47fc12040852d` (correction des waiters du playback-smoke) — présent dans l'historique                                         |
| Commit de livraison V35 | `fe4d7d91798cef6b26bae5b08f4c2acfe314fe2a` (rapport V35) — HEAD de la PR                                                                                  |
| Rapport V34             | références vérifiées : commit final `9bba8c6` + artifact du run vert 38134265335 (id 11700787426) — artefact existant, `head_sha` du run = `9bba8c6`      |
| Rapport V35             | références vérifiées : commit applicatif `1561071` + artifact du run vert 38146300310 (id 11704859239) — artefact existant, `head_sha` du run = `1561071` |
| Rapports V30–V35        | tous présents dans le dépôt, historique non effacé                                                                                                        |
| Branche de session      | conservée telle quelle (pas de nouvelle branche : une branche détachée couperait le lien avec la PR #9)                                                   |

## 2. Corrections réellement apportées par V36

**Aucune correction de code** : tous les contrôles de la mission sont passés au vert sans reproduire le moindre défaut. Conformément à la règle « corriger uniquement les défauts reproduits ou démontrés », aucune modification applicative n'a été ajoutée à la veille de la livraison. Le seul ajout de V36 est ce rapport.

## 3. Tests exécutés pendant V36 et résultats

| Contrôle                                                               | Résultat                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation reproductible (`npm ci --legacy-peer-deps`, identique CI) | OK                                                                                                                                                                                                                                                                  |
| TypeScript `tsc --noEmit`                                              | OK                                                                                                                                                                                                                                                                  |
| **Suite Jest complète (parallèle)**                                    | **2436 réussis, 0 échec, 14 ignorés** (189 suites)                                                                                                                                                                                                                  |
| **Suite Jest complète (séquentielle `--runInBand`)**                   | **idem : 2436/0/14** — preuve que les tests ne dépendent pas d'un ordre d'exécution fragile                                                                                                                                                                         |
| Tests backend (`server/`, `node --test`)                               | **45/45 réussis**                                                                                                                                                                                                                                                   |
| ESLint                                                                 | 0 erreur (1 avertissement préexistant)                                                                                                                                                                                                                              |
| Prettier                                                               | conforme                                                                                                                                                                                                                                                            |
| `git diff --check`                                                     | propre                                                                                                                                                                                                                                                              |
| Environnement de test                                                  | la suite par défaut (`*.unit.test.ts`) ne contient AUCUN accès réseau externe : les 2 suites au nom « online » testent les AIDES de vérification avec des doublures/serveur loopback ; le vrai banc réseau (`*.online.test.ts`) est exclu du `testMatch` par défaut |

### Vérification Android finale (run 38147637751, commit `fe4d7d9`, conclusion `success`)

Workflow « APK Android » complet : build, installation et lancement sur émulateur Android 14 x86_64, puis smoke :

- **Recherche → piste jouable → `playing` : verdict `started`** — recherche réelle soldée, piste jouable sélectionnée, moteur expo-av a confirmé `playing` et s'y est maintenu.
- **Changement de piste : vérifié RÉEL** — lecture confirmée par le moteur sur une deuxième piste issue de la recherche réelle.
- **Pause puis reprise : CONFIRMÉES** par l'état moteur réel après lecture démarrée.
- **Logs de crash et erreurs de commandes natives : aucun crash, aucune erreur de commande native sur le chemin de lecture.** Les avertissements du run concernent uniquement le pont Spotify Web (normal sans compte : handshake expiré, aucune capacité revendiquée — comportement honnête), une commande de test refusée avant émission (pont non prêt, signalé non bloquant) et des notifications de dépréciation React Native/Gradle cosmétiques.

**Limite d'affichage explicite (consigne) :** le `playing` mesuré sur l'émulateur est un état du moteur audio confirmé par le runtime ; l'émulateur CI tourne sans sortie sonore (`-noaudio`). Ce n'est donc **pas une preuve que le son est audible** — voir §7.

## 4. Sources musicales (comportement vérifié, inchangé)

- **Audius prioritaire** quand son flux est réellement disponible (ordre de cascade `audius → youtube` dans `services/audio/index.ts`, vérifié par tests et par le smoke : la piste retenue sur émulateur est Audius).
- **YouTube** reste source de recherche et recours de lecture quand le flux est résoluble ; depuis les IP d'infrastructure GitHub, le contrôle anti-bot de YouTube bloque la résolution (mesures V34 : `LOGIN_REQUIRED` sur clients valides) — c'est une restriction d'environnement, PAS un défaut de code et PAS une preuve d'échec sur téléphone résidentiel. Aucun cookie/compte/jeton non autorisé n'est utilisé.
- **Spotify facultatif** : recherche et lecture Audius fonctionnent sans compte (prouvé par le smoke et le banc) ; aucun Client ID tiers, pas d'exigence Premium.
- **Backend Melodix** : aucune instance configurée (`MELODIX_BACKEND_URL` non défini) — il n'est PAS prétendu fonctionnel ; le code serveur existe (`server/`, 45/45 tests) et sera mesuré automatiquement par le banc dès qu'une instance sera déployée et la variable définie.

## 5. APK de livraison

- **Commit applicatif** (dernier commit modifiant le code de l'app) : `15610714863d475ea42d89106dc47fc12040852d`
- **Commit final de livraison V36** : le commit de ce rapport — code applicatif strictement identique à `fe4d7d9`/`1561071` (aucune ligne d'app modifiée par V36).
- **Fichier livré** : `Melodix-v4.5.0-test.30-<sha-du-commit>.apk`
  - versionName `4.5.0-test.30` · versionCode `45030` · minSdk 23 · targetSdk 34 · architectures `arm64-v8a armeabi-v7a x86 x86_64` · signature V3 (empreinte du certificat `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`)
  - taille de l'archive : ~47,09 Mo (47 090 243 octets mesurés au run `fe4d7d9`) · ~89 Mo installé
  - **SHA-256 du binaire : `13bc7d1a914cb4abe3ed272db97d7ce5dc4844a21ec15ff2a03dcf9e9b995997`** — calculé par le workflow sur le fichier APK réel (annotations des runs), identique pour les builds `1561071` et `fe4d7d9`.
- **Correspondance APK ↔ commit annoncé** : vérifiée par trois faits — (1) le `head_sha` de chaque run cité est exactement le commit annoncé (API GitHub, vérifié cette mission pour 38134265335/`9bba8c6`, 38146300310/`1561071`, 38147637751/`fe4d7d9`) ; (2) le nom de chaque artefact embarque le SHA de son commit ; (3) les commits « docs seul » produisent un binaire au SHA-256 IDENTIQUE au commit applicatif (démontré deux fois : `e3b326a7…` pour `8822099`→`9bba8c6` en V34, `13bc7d1a…` pour `1561071`→`fe4d7d9` en V35) — le build du commit de livraison V36 porte donc le même binaire, vérifiable dans son run.
- **Transparence sur le calcul d'empreinte** : le téléchargement des artefacts est IMPOSSIBLE depuis l'environnement de travail de cette mission (l'hôte de stockage des artefacts GitHub n'est pas dans la liste de sortie réseau autorisée — tentative `gh run download 38147637751` documentée, échec `EOF` vers `*.blob.core.windows.net`). L'empreinte ci-dessus est donc celle **calculée par le workflow lui-même sur le véritable fichier APK**, pas un recalcul local ; toute personne téléchargeant l'artefact peut la confirmer par `sha256sum`. Aucune valeur n'a été inventée ni recopiée sans vérification d'association au commit.
- **Runs et artefacts vérifiés** :
  - livraison V36 (commit du rapport) : run et artefact publiés et vérifiés dans le commentaire de la PR #9 accompagnant ce commit (le run se déclenche à la poussée ; son `head_sha` = ce commit).
  - dernier état vert antérieur : run 38147637751 (`fe4d7d9`, `success`) — artefact https://github.com/Souxch06/Melodix/actions/runs/38147637751/artifacts/11705855515
  - commit applicatif : run 38146300310 (`1561071`, `success`) — artefact https://github.com/Souxch06/Melodix/actions/runs/38146300310/artifacts/11704859239

## 6. État exact de la livraison

- **PR #9** : ouverte, MERGEABLE, tête = ce commit après poussée — non fusionnée (aucune autorisation reçue).
- **`main`** : `fceab85950b069edcb65ed718a8ffd419a1bc785` — intact.
- **Aucune release GitHub publiée** (autorisation explicite requise).
- **Smoke test** : vert au dernier run complet exécuté (38147637751 sur `fe4d7d9`, code identique) — lecture `started`, changement de piste `started`, pause/reprise `ok` ; le run du commit de livraison est attendu et son résultat publié en commentaire de PR (même code = résultat attendu identique, toute différence serait un signal à investiguer).

## 7. Limites nécessitant encore un téléphone physique

1. **Sortie sonore physique** : l'émulateur CI est sans audio ; le verdict `playing` prouve l'état du moteur, pas l'audibilité. Un appareil réel est requis pour entendre le flux.
2. **YouTube sur réseau résidentiel** : la résolution des flux est bloquée par l'anti-bot depuis les IP GitHub ; sur téléphone (IP résidentielle) la cascade 4 profils 2026 devrait résoudre — à confirmer simplement en ouvrant l'app. Ce point n'est établi par aucun test disponible en CI.
3. **Lecture Spotify avec compte autorisé** : impossible en CI (aucun compte utilisable, aucun contournement) ; le wiring OAuth PKCE est prouvé (deep-links cold/warm), pas la session complète.
4. **Écran verrouillé / MediaSession longue durée** : le service foreground, la session média et les commandes sont vérifiés par le smoke, mais pas l'usage prolongé (plusieurs heures, verrouillage répété).

## 8. Liens vérifiés

- PR #9 : https://github.com/Souxch06/Melodix/pull/9
- Commit applicatif V35 `1561071` : https://github.com/Souxch06/Melodix/commit/15610714863d475ea42d89106dc47fc12040852d
- Commit de livraison V35 `fe4d7d9` : https://github.com/Souxch06/Melodix/commit/fe4d7d91798cef6b26bae5b08f4c2acfe314fe2a
- Run APK final V35 (`fe4d7d9`, vert) : https://github.com/Souxch06/Melodix/actions/runs/38147637751 — artefact https://github.com/Souxch06/Melodix/actions/runs/38147637751/artifacts/11705855515
- Run APK vert du commit applicatif `1561071` : https://github.com/Souxch06/Melodix/actions/runs/38146300310 — artefact https://github.com/Souxch06/Melodix/actions/runs/38146300310/artifacts/11704859239
- Run du commit de livraison V36 : URL publiée et vérifiée dans le commentaire de la PR #9 accompagnant ce commit (déclenché par la poussée elle-même).
