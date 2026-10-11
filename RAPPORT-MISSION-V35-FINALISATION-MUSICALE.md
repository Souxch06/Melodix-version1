# RAPPORT DE MISSION V35 — FINALISATION DE L'EXPÉRIENCE MUSICALE MELODIX

**Date :** 11 octobre 2026
**Branche de travail :** `arena/5ef0ee6a-melodix` (PR #9, ouverte, aucun merge)
**Point de départ :** fin V34 vérifiée (`9bba8c6`), environnement local restauré depuis l'état distant (arbre comparé identique avant restauration — aucune perte).
**Politique de preuve :** chaque affirmation renvoie à un test exécuté ou à une mesure CI. Quatre niveaux distingués : (1) tests simulés, (2) mesures réseau réelles, (3) démarrage confirmé par le moteur audio, (4) son réellement entendu — ce dernier niveau reste hors de portée de la CI et exige un appareil physique.

---

## 1. Sécurisation du point de départ (résolue)

- **Environnement local réinitialisé** : le checkout était revenu à la base `4cd7553` avec l'arborescence V34 présente mais non commitée localement. Vérification faite : arbre de travail indexé **strictement identique** au distant `9bba8c6` (diff vide), puis pointeur de branche restauré sur `9bba8c6` sans toucher au contenu. Aucune modification perdue, aucun écrasement.
- **Divergence de livraison V34 résolue** : le rapport V34 citait `8822099` comme commit final alors que le HEAD réel de la PR #9 est `9bba8c6` (qui possède SON build vert : run 38134265335, APK `Melodix-v4.5.0-test.30-9bba8c6.apk`, sha256 `e3b326a718918e4594267e5a74bcfcf32183bc4f87d907f50da8c4df1c7856b4`). Le rapport V34 a été corrigé en ce sens (commit `314247c`).
- **État GitHub vérifié** : `main` intact (`fceab85950b069edcb65ed718a8ffd419a1bc785`), PR #9 ouverte et MERGEABLE, aucun merge ni fermeture.

## 2. Audit du lecteur — problèmes réellement trouvés

Méthode : audit du code (moteur `services/player.ts` 2714 lignes, `context/PlayerContext.tsx`, `MiniPlayer`, `FullPlayer`, mutations de file, cascade de résolution Audius → YouTube, pont MediaSession), puis **preuves par tests adverses**. Aucun défaut du moteur n'a été démontré par cet audit — le moteur a été durci par les missions v7/v9/V32/V33 et les nouveaux tests adverses le confirment (section 3). Conformément à la règle finale de la mission, ce qui est correct a été CONSERVÉ et PROUVÉ, pas réécrit.

Le seul défaut réel trouvé et corrigé cette mission est dans la **fixture de smoke** (pas dans le lecteur) : sur l'émulateur, une commande transport native qui ne rend pas pouvait geler la séquence de vérification sans produire de verdict (voir §3.4 — mesure CI à l'appui).

Points audités et jugés conformes (preuves dans les tests existants + nouveaux) :

- Lecture/pause/reprise et changement de piste : tokens d'annulation, intention transport prioritaire sur l'état, pause honorée pendant le buffering.
- File, suivant/précédent, repeat (off/all/one), shuffle (courant épinglé en tête d'ordre, remappage à chaque mutation).
- Synchronisation mini-lecteur ↔ plein écran ↔ contexte : un seul état moteur relayé par le PlayerContext — prouvé par le NOUVEAU test d'intégration (§3.2).
- Erreurs de flux, pistes indisponibles, chargement : classement honnête (`error`/`unavailable`/notice), avance automatique sans boucle de panne, piste morte retentable par geste manuel.
- Favoris/historique : suites existantes vertes (39 tests bibliothèque+historique) ; l'historique n'enregistre qu'au `playing` confirmé par le runtime (`markPlaybackStarted`), jamais sur une simple URL résolue.
- Arrière-plan/notification/MediaSession : pont tolérant (no-op sans natif), activation conditionnée au réglage `staysActiveInBackground` (PreferencesContext → moteur), smoke Android V33/V34 ayant validé service foreground + commandes sur émulateur.
- Honnêteté des sources : `playing` n'est émis que sur confirmation runtime (`isPlaying=true`) ou publication Spotify Web à identité exacte — vérifié par test « aucune fausse lecture » (§3.1).

## 3. Tests ajoutés et résultats détaillés

### 3.1 Moteur — suite adverse `services/__tests__/playerV35Reliability.unit.test.ts` (niveau 1 : simulé)

**20 tests, 20 réussis.** Cas couverts : rafale de deux playQueue (un seul Sound vivant) ; `next()` pendant une résolution lente (le résultat tardif ne crée jamais de Sound) ; pause/reprise pendant buffering ; erreur de flux en lecture (avance, jamais `playing` sur la morte) ; piste sans flux (skip honnête) ; toutes pistes mortes (fin propre, ≤ 1 tentative par piste) ; piste morte exclue de l'avance auto mais retentable manuellement ; repeat one/all/off (fin de file → `ended` avec position réelle) ; shuffle (épinglage du courant, next suit l'ordre, OFF restaure l'ordre) ; previous (> 3 s → restart, sinon piste précédente) ; suppression du courant (le suivant joue), suppression d'un autre (même Sound continue), déplacement sans changer le courant, playNext avec déduplication, addToQueue sans doublon ; « chargé mais non joué » jamais promu `playing` ; deux toggles rapides = pause puis play.

### 3.2 Synchronisation des surfaces — `context/__tests__/playerStateSyncV35.unit.test.tsx` (intégration réelle)

**4 tests, 4 réussis.** Moteur réel + PlayerProvider réel + MiniPlayer ET FullPlayer rendus ensemble (seul expo-av est stubbé) : une seule émission moteur met à jour les deux surfaces à l'identique ; pause tapée sur le mini-lecteur bascule aussi le plein écran ; changement de piste suivi par les deux surfaces ; erreur de flux → repli sur la piste suivante, jamais de faux `playing`. Preuve directe que le contexte unique synchronise mini-lecteur, plein écran et état global.

### 3.3 Traductions FR/EN — `data/__tests__/translationsParity.unit.test.ts` (non-régression)

**5 tests, 5 réussis.** Aucune surcharge FR orpheline, aucune divergence fonction/chaîne ni d'arité avec la base EN, messages critiques du lecteur présents en FR, aucun texte vide. Parité vérifiée propre à l'entrée de mission (aucun défaut trouvé).

### 3.4 Smoke « piste trouvée → lecture réelle » — phase 2 V35 (niveau 3 : démarrage confirmé par le moteur, sur émulateur)

Extension de la fixture V34 : après une lecture confirmée, la fixture vérifie désormais (a) un **changement de piste réel** vers une deuxième piste jouable de la recherche et (b) les **commandes pause/reprise**, chacune confirmée par l'état moteur observé (jamais par la seule résolution de la commande). Fallback honnête `skipped-single-track` quand une seule piste jouable existe.

- **Tests unitaires : 16/16** (`services/__tests__/playbackSmoke.unit.test.ts`), dont : changement de piste confirmé, piste unique sautée sans invention, pause jamais confirmée → `failed-pause` (reprise non tentée), reprise jamais confirmée → `failed-resume`, échec de la piste 2 sans corrompre le verdict principal, phases 2 `null` quand la lecture n'a jamais démarré, **commande pause suspendue → séquence bornée et classée** (test ajouté après la mesure CI ci-dessous).
- **Mesure CI (run 38139115491, commit `e09c331`) :** `verdict:started` (lecture confirmée et maintenue) ; **`track-change:started` — changement de piste réel vérifié** (le moteur a confirmé `playing` sur une deuxième piste issue de la recherche réelle) ; pause/reprise **non observées dans le budget** — diagnostic : une commande native qui ne rend pas gelait la séquence sans breadcrumb.
- **Correction (commit `5c97988`) :** commandes transport **bornées** dans la fixture (le gel natif dégèle la séquence et l'observateur classe `failed-pause`/`failed-resume` au lieu du silence) + crash de fixture journalisé en logcat (`[PlaybackSmoke] crash category=…`). Re-mesure sur émulateur : voir §5.

### 3.5 Portes de qualité complètes

- TypeScript (`tsc --noEmit`) : OK.
- Jest complet : **2434 réussis, 0 échec, 14 ignorés** (189 suites) — dont l'intégralité des suites existantes (non-régression).
- ESLint : 0 erreur (1 avertissement préexistant). Prettier : OK. `git diff --check` : OK.
- Build APK Android + smoke émulateur : verts sur chaque commit poussé (runs 38139115491 `e09c331`, et run final — voir §6).

### 3.6 Mesures réseau réelles inchangées (niveau 2)

Le code réseau de recherche/résolution n'a PAS été modifié par V35 ; les mesures réelles V34 restent donc valides (banc `real-measures`, 14 cas soldés, 250 résultats, 0 erreur source) : recherche YouTube fonctionnelle ; flux YouTube bloqués depuis les IP du runner par le contrôle anti-bot (`LOGIN_REQUIRED` sur clients valides, profil intégré refusé) — restriction d'environnement, pas un défaut de code, et **pas une preuve d'échec sur téléphone** ; Audius 6/14 flux vérifiés disponibles ; sonde Spotify 401 (joignable). Spotify ne bloque ni la recherche ni la lecture Audius (circuit par source, vérifié par tests `sourceCircuit`/`spotifySearchCircuit` et par le banc).

## 4. Fonctionnalités : validées / partiellement validées / non vérifiables

**Validées** (tests simulés + intégration + smoke émulateur) : lecture/pause/reprise ; changement de piste ; file, suivant/précédent, repeat, shuffle ; erreurs de flux et pistes indisponibles classées sans bloquer la file ; synchronisation mini/plein écran/contexte ; honnêteté « jamais playing sans confirmation moteur » ; favoris/historique (suites vertes, historique au playing confirmé) ; recherche → sélection piste jouable → lecture réelle démarrée et changement de piste réel sur émulateur ; parité FR/EN ; arrière-plan/MediaSession (wiring + smoke V33/V34).

**Partiellement validées** : commandes pause/reprise après lecture — la logique est prouvée hors-ligne (16 tests) ; la mesure sur émulateur a montré un gel natif de la commande, corrigé par bornage ; la mesure requalifiée arrive au §5.

**Non vérifiables en CI (exigent un appareil physique)** : son réellement entendu (émulateur `-noaudio`) ; flux YouTube depuis une IP résidentielle (le runner est contrôlé par l'anti-bot — aucun contournement par compte/cookie/jeton, conformément aux consignes) ; login Spotify réel et lecture Spotify (aucun compte utilisable en CI) ; comportement écran verrouillé longue durée.

## 5. État des livraisons

- **PR #9** : ouverte, tête `arena/5ef0ee6a-melodix` ; `main` intact (`fceab85…`) ; aucun merge.
- **Commit final :** `<COMMIT_FINAL>` (à la fin de cette mission).
- **APK** : `<APK_LIEN>` — issue du workflow APK Android **vert correspondant au commit final** ; versionName `<VERSION>`, taille `<TAILLE>`, sha256 `<SHA256>`.
- **Rapports** : V30–V34 conservés (rapports V34 corrigés), V35 = ce rapport ; historique non effacé.
- **Vérification smoke du commit final** : verdict lecture `<VERDICT_LECTURE>` ; changement de piste `<VERDICT_CHANGEMENT>` ; pause/reprise `<VERDICT_COMMANDES>`.

## 6. Ce qui exige encore un appareil physique

1. Écoute réelle (son émis) — la CI prouve l'état moteur, pas l'acoustique.
2. Flux YouTube en conditions résidentielles — à tester simplement en ouvrant l'app sur un téléphone ; la cascade lecteur est prête (4 profils 2026).
3. Commandes écran verrouillé/notification sur la durée (le wiring est prouvé par smoke, pas l'usage prolongé).
4. Session Spotify complète (compte requis, interdit d'en utiliser un tiers).
