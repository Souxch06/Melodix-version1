# Rapport de mission V50 — Attribution Jamendo visible et audit de conformité avant activation

**Branche :** `arena/5ef0ee6a-melodix`
**Commit de la mission :** `6c30c7965763adfae8a58c587f97c2f8282dd04c`
**Commit de départ :** `53a7cc7` (V49, vérifié identique au dépôt distant)
**`main` :** `fceab85950b069edcb65ed718a8ffd419a1bc785` — **non modifié**
**PR #9 :** `OPEN`, `mergedAt = null` — **ni fusionnée ni fermée**
**Version :** `4.5.0-test.37` / `versionCode 45037`

---

## 0. Avertissement de lecture

Ce rapport sépare strictement trois choses, conformément à la demande :

1. **§7 — Conformité technique** : ce que le code fait, prouvé par des tests exécutés.
2. **§4 — Obligations contractuelles** : ce qui est confirmé par le texte, et ce qui reste
   **incertain**. **Aucune conformité juridique n'est annoncée.**
3. **§8 — Résultats réellement mesurés** : ce qui a été mesuré sur le réseau, et ce qui ne
   l'a **pas** été.

---

## 1. État réel vérifié avant toute modification

Vérifié par commandes, pas supposé :

| Élément                         | Valeur constatée                                              |
| ------------------------------- | ------------------------------------------------------------- |
| `HEAD` local au démarrage       | `53a7cc7`                                                     |
| `origin/arena/5ef0ee6a-melodix` | `53a7cc7` (identique)                                         |
| Arbre de travail                | propre, 0 modification                                        |
| `origin/main`                   | `fceab859` (inchangé)                                         |
| PR #9                           | `OPEN`, non fusionnée                                         |
| `node_modules`                  | présent, aucun `npm ci` nécessaire                            |
| Workflows à `53a7cc7`           | banc `38360843746` **success**, APK `38360849500` **success** |

Aucun reset, aucune réinitialisation destructive, aucune suppression de travail existant.
Les rapports V30–V49 sont conservés.

---

## 2. Ce que la V49 avait laissé ouvert

La V49 avait corrigé la **capture** des données d'attribution : `shareurl` et `license_ccurl`
sont renvoyés **par défaut** par `/v3.0/tracks` (vérifié sur la documentation officielle,
exemple de réponse), alors que l'adaptateur les **jetait**. Elles étaient désormais
enregistrées dans un cache borné (300 entrées) et exposées par `getJamendoAttribution()`.

**Mais aucune interface ne les affichait.** La clause 4.1 restait donc **insatisfaite** :
capturer la donnée n'est pas s'y conformer. C'est l'objet exact de cette mission.

---

## 3. Examen des obligations Jamendo

### 3.1 Source et version du texte

- **URL :** `https://devportal.jamendo.com/api_terms_of_use`
- **Version :** « _last modified on September 17, 2013_ » — c'est la seule version publique
  accessible. **Aucune version plus récente n'a pu être confirmée** ; si Jamendo a publié un
  texte postérieur non accessible publiquement, cette analyse serait à reprendre.

### 3.2 Obligations **confirmées** par le texte

| Clause  | Exigence littérale                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.1** | L'application doit **créditer les membres Jamendo comme créateurs** du contenu, **créditer Jamendo comme fournisseur**, et **fournir un lien direct depuis chaque contenu vers la page de ce contenu sur la plateforme Jamendo**.                                             |
| **3.1** | Chaque contenu est publié sous licence **Creative Commons** ; le développeur doit l'utiliser conformément à cette licence et ne pas dénaturer la source.                                                                                                                      |
| **3.3** | API gratuite pour un usage **non commercial** uniquement ; les applications ne doivent **pas être conçues pour mettre le contenu en cache ni offrir d'accès hors ligne** ; la mise en cache n'est admise que dans la mesure **raisonnablement nécessaire** au fonctionnement. |
| **4.2** | Ne pas utiliser les marques Jamendo, ni le mot « jamendo », d'une manière suggérant que l'application provient de Jamendo ou est approuvée par lui.                                                                                                                           |
| **2**   | Identifiants « strictement personnels », ne devant pas être partagés ni divulgués à des tiers ; un **Client ID unique** par application ; le champ « description » de l'application déclarée doit contenir un lien direct vers l'application publiée.                         |

### 3.3 Interprétations **incertaines** — à ne pas trancher seul

1. **Client ID embarqué vs clause 2 (bloquant, non résolu).**
   Un `client_id` inliné dans un APK distribué est **de fait divulgué à chaque utilisateur**.
   La clause 2 interdit la divulgation à des tiers. Les rapports V47/V48 affirmaient que cet
   identifiant est « public par conception » : c'est techniquement vrai du point de vue de
   Jamendo (il identifie l'application, il n'est pas un secret d'authentification), mais
   **cela ne suffit pas à écarter la lettre de la clause 2**.
   → **Statut : non résolu.** Une clarification écrite de Jamendo
   (`licensing@jamendo.com`) est nécessaire **avant** toute distribution d'un APK armé.

2. **Portée exacte du « lien direct » (4.1).**
   Le texte ne précise pas si le lien doit être visible en permanence, ni s'il doit être
   accessible depuis la liste de résultats en plus du lecteur. L'implémentation retenue
   (§5) place le lien dans le lecteur plein écran. C'est une **interprétation raisonnable**,
   pas une exigence textuellement confirmée.

3. **Caractère suffisant de la mention de licence (3.1).**
   Afficher l'URL `license_ccurl` renvoyée par l'API satisfait l'esprit de la clause, mais le
   texte n'impose pas de formulation précise. Non confirmable sans retour de Jamendo.

4. **Licence des boutons/logos (4.1, second alinéa).**
   Jamendo _peut_ fournir des boutons ou logos à utiliser sans modification. **Aucun kit de
   ce type n'a été récupéré** ; l'implémentation utilise donc du texte simple et aucune
   marque Jamendo. Cela satisfait la clause 4.2 par construction.

### 3.4 Conséquence sur l'activation

Conformément à la consigne : **Jamendo reste désactivée par défaut.**
Aucun identifiant — réel ou fictif — n'est intégré au dépôt, au code ou au rapport.
Le point 3.3.1 constitue un **blocage documenté** : tant que Jamendo n'a pas répondu par
écrit sur la compatibilité d'un `client_id` embarqué avec la clause 2, la distribution d'un
APK armé n'est pas recommandée.

---

## 4. Décision de conception de l'interface

### 4.1 Ce qui a été examiné

| Élément                                    | Constat                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models/LibraryItem/LibraryItemModel.ts`   | Modèle **partagé par toutes les sources**. L'élargir pour un seul fournisseur aurait fait porter un champ Jamendo à Audius/YouTube/iTunes/Spotify. **Écarté.**                                                        |
| `services/player.ts:53-68` (`PlayerTrack`) | Même constat : type partagé. **Non modifié.**                                                                                                                                                                         |
| `components/Player/FullPlayer.tsx:282-286` | Badge `providerName` (« _Lu avec …_ ») juste sous l'artiste : ancrage naturel, déjà source-spécifique. **Retenu.**                                                                                                    |
| `components/Search/Search.tsx`             | Ne transmet aucun `availability` à `SearchResultRow` : **aucune source** n'y affiche de badge. Ajouter un badge Jamendo ici aurait créé une asymétrie visible uniquement pour Jamendo. **Écarté** (voir limite §9.3). |
| `components/Player/MiniPlayer.tsx`         | Surface réduite, déjà dense. **Écarté** pour rester minimal.                                                                                                                                                          |
| `screens/SettingsScreen.tsx:449,493`       | Motif `void Linking.openURL(url)` déjà utilisé dans le projet. **Réutilisé.**                                                                                                                                         |

### 4.2 Solution retenue (minimale)

Deux nouveaux fichiers, **aucun modèle partagé élargi**, **aucun comportement existant
modifié** pour les autres sources :

- `api/jamendo/attribution.ts` (200 lignes) — validation et résolution.
- `components/Player/JamendoAttribution.tsx` (119 lignes) — rendu, inséré après le badge
  fournisseur dans `FullPlayer` (7 lignes ajoutées, dont commentaires).

Le composant renvoie `null` **sauf** si la piste est Jamendo **et** si une attribution est
connue. Les autres sources ne voient **aucun** changement de rendu.

---

## 5. Règles de validation — rien n'est inventé

### 5.1 Lien vers la page d'origine (`shareurl`)

Accepté **uniquement** si :

- schéma **`https`** (le `http` simple est refusé) ;
- hôte exactement `jamendo.com` ou `www.jamendo.com` (tout autre hôte ou sous-domaine,
  y compris `api.jamendo.com`, est refusé) ;
- chemin `/track/<identifiant numérique>` ;
- l'URL canonique est **reconstruite à partir du seul identifiant validé** : query string et
  fragment sont **écartés**, aucun paramètre non validé ne peut passer.

Refusés explicitement : `javascript:`, `file:`, `intent:`, chaînes vides, valeurs absentes,
URL malformées.

### 5.2 Lien de licence (`license_ccurl`)

Accepté uniquement en `http`/`https`, hôte `creativecommons.org`, chemin commençant par
`/licenses/`.

### 5.3 Créateur

**Aucun nom n'est inventé.** Un défaut réel a été découvert et corrigé à cette occasion :
l'adaptateur remplaçait un `artist_name` vide par le littéral **codé en dur**
`'Artiste inconnu'`. L'afficher dans « _Créé par …_ » aurait crédité un **nom de
substitution**, ce que la clause 4.1 interdit (elle impose de créditer les membres Jamendo
**réels**). Le littéral devient la constante exportée `JAMENDO_UNKNOWN_ARTIST`, et
l'attribution le traite comme « créateur inconnu » : seule la mention fournisseur reste
affichée.

### 5.4 Clés de traduction

Quatre clés ajoutées **dans les deux fichiers** `data/fr-fr.ts` et `data/en-gb.ts`
(parité vérifiée par `data/__tests__/translationsParity.unit.test.ts`) :
`jamendoAttributionCredit(artist)`, `jamendoAttributionProvider`,
`jamendoAttributionOriginal`, `jamendoAttributionLicense`.

### 5.5 Accessibilité

Rôles `link`, `accessibilityLabel` explicites, zones tactiles ≥ 32 pt de hauteur. Aucun
libellé ne reproduit une marque Jamendo de façon à suggérer une origine ou une
approbation (clause 4.2).

---

## 6. Tests de régression

### 6.1 Couverture ajoutée

**`components/Player/__tests__/jamendoAttribution.unit.test.tsx` (nouveau, 345 lignes, 26 tests)**

- Assainissement du lien d'origine : format documenté accepté et canonisé, autre hôte /
  autre chemin / identifiant non numérique refusés, schémas dangereux refusés, valeurs
  absentes ou vides refusées, query et fragment écartés.
- Assainissement de la licence : Creative Commons accepté, autre hôte ou chemin refusé.
- Attribution renderable : champs validés, identifiant avec ou sans préfixe `jamendo:`,
  piste inconnue → `null`, **aucun lien inventé à partir de l'identifiant**, créateur absent,
  lien invalide écarté sans affecter les autres champs.
- Affichage : crédit + mention fournisseur + lien d'origine + licence ; **ouverture réelle**
  du lien d'origine et de la licence au toucher (`Linking.openURL` espionné, URL exacte
  vérifiée) ; **aucun lien** quand les URL sont invalides ; mention fournisseur seule quand
  le créateur est inconnu.
- **Aucun faux crédit** pour Audius, YouTube, iTunes et Spotify (5 variantes d'identifiant,
  y compris un identifiant Spotify brut), **même avec une attribution Jamendo présente en
  cache**.
- **Jamendo non configurée** : aucune requête émise (`fetch` jamais appelé), aucun bloc
  d'attribution rendu.

**`components/Player/__tests__/FullPlayer.unit.test.tsx` (+124 lignes, 2 tests)**

- Intégration **réelle** dans le lecteur plein écran : crédit, mention fournisseur, lien
  d'origine et licence rendus par `FullPlayer` pour une piste Jamendo.
- **Aucun** crédit Jamendo pour une piste Spotify alors qu'une attribution Jamendo **est** en
  cache.

Le cache d'attribution est alimenté par le **chemin de production** (`searchJamendoTracks`
avec un `fetch` remplacé), jamais par écriture directe dans le cache. L'armement passe par la
variable d'environnement **documentée** (`EXPO_PUBLIC_JAMENDO_CLIENT_ID`), avec un
identifiant **de test**, supprimé après chaque test.

### 6.2 Preuves de réversion — les tests tombent quand le comportement est retiré

| #      | Comportement retiré                                                  | Résultat                  | Restauré |
| ------ | -------------------------------------------------------------------- | ------------------------- | -------- |
| **R1** | `<JamendoAttribution trackId={current.id} />` retiré de `FullPlayer` | **1 échec / 40 réussis**  | 41/41    |
| **R2** | Assainissement du lien d'origine neutralisé (passe-plat)             | **7 échecs / 19 réussis** | 26/26    |
| **R3** | Créateur de substitution affiché tel quel                            | **2 échecs / 24 réussis** | 26/26    |

Chaque retrait a été **restauré** et la suite **relancée** pour confirmer le retour au vert.

**Résultat honnête sur une quatrième tentative (R4) :** retirer **uniquement** la garde de
préfixe `jamendo:` — en conservant la normalisation — **ne fait échouer aucun test**
(26/26). La protection contre les faux crédits vient donc **d'abord** du fait que le cache
d'attribution est indexé par identifiant Jamendo **nu** : un identifiant d'une autre source
ne peut physiquement pas y résoudre. La garde de préfixe est une **défense en profondeur**,
pas la protection principale. Ce point est signalé plutôt que présenté comme une preuve.

### 6.3 Ce que les tests ne prouvent **pas**

- **Aucune mesure réseau** : `fetch` est remplacé, `api.jamendo.com` n'est **pas joignable**
  depuis l'environnement de travail.
- **Aucune lecture audible sur appareil physique** : ce sont des tests automatisés.
  L'ouverture d'un lien est vérifiée au niveau de l'appel `Linking.openURL`, **pas** du
  rendu réel d'un navigateur Android.

---

## 7. Conformité **technique** (prouvée par des tests exécutés)

| Exigence                                   | État          | Preuve                                                                                               |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------- |
| Crédit du créateur (4.1)                   | **Satisfait** | Tests d'affichage + R3                                                                               |
| Mention de Jamendo comme fournisseur (4.1) | **Satisfait** | Test « mention fournisseur seule »                                                                   |
| Lien direct vers la page du contenu (4.1)  | **Satisfait** | Test d'ouverture + R1 + R2                                                                           |
| Indication de licence (3.1)                | **Satisfait** | Test d'ouverture du lien de licence                                                                  |
| URL validées et assainies avant ouverture  | **Satisfait** | 12 tests de validation + R2                                                                          |
| Aucun artiste, licence ou lien inventé     | **Satisfait** | Test « n'invente jamais » + R3                                                                       |
| Aucune marque Jamendo détournée (4.2)      | **Satisfait** | Texte simple, aucun logo                                                                             |
| Cache « raisonnablement nécessaire » (3.3) | **Satisfait** | URLs/métadonnées seules, borné à 300, non persistant, aucun octet audio (verrouillé par 3 tests V49) |
| Comportement des autres sources inchangé   | **Satisfait** | 39 tests `FullPlayer` préexistants inchangés + tests anti-faux-crédit                                |
| Jamendo `skipped` sans configuration       | **Satisfait** | 2 tests dédiés + annotation CI (voir §8)                                                             |

---

## 8. Résultats **réellement mesurés**

### 8.1 Barrières locales (exécutées, pas simulées)

| Barrière                 | Résultat                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`       | **0 erreur**                                                                                             |
| `npx jest --silent`      | **207 suites réussies · 2698 tests réussis · 0 échec · 14 ignorés** (V49 : 2670 → **+28**)               |
| `npm run lint`           | **0 erreur**, 1 avertissement **préexistant** dans un fichier non touché                                 |
| `npm run prettier:check` | **conforme** (après formatage des 4 fichiers modifiés)                                                   |
| `git diff --check`       | **propre**                                                                                               |
| Secret dans le diff      | **aucun** (seules occurrences : le nom de la variable `EXPO_PUBLIC_JAMENDO_CLIENT_ID`, jamais de valeur) |

### 8.2 Intégration continue au commit `6c30c79`

| Workflow            | Exécution                                                                     | Conclusion  |
| ------------------- | ----------------------------------------------------------------------------- | ----------- |
| Banc réseau Melodix | [`38364842161`](https://github.com/Souxch06/Melodix/actions/runs/38364842161) | **success** |
| APK Android         | [`38364848815`](https://github.com/Souxch06/Melodix/actions/runs/38364848815) | **success** |

**Banc réseau (mesures réelles, statut `real-measures`) :**

- Réseau confirmé ; **39/39 cas soldés**.
- Résultats par source : `{"spotify":0,"backend":0,"audius":271,"youtube":497,"itunes":4323,"jamendo":0}`
  — **5079 au total**, 5079 identifiants jouables.
- **Erreurs par source : `{}`**
- Sondes : audius 200 (243 ms), youtube 200 (185 ms), spotify 401 (réponse reçue = refus
  fonctionnel, 82 ms), itunes 200 (59 ms).

**APK :**

- Étapes clés en succès : TypeScript/ESLint/Prettier (10), tests JS (11), tests Kotlin
  Robolectric (14), compilation (15), alignement 16 Kio + signature (16), intégrité et
  installabilité (19), **installation et lancement réel sur Android 14 (21)**, diagnostic
  Jamendo (23), publication de l'artefact (24).
- Artefact **`11796782149`** — `Melodix-v4.5.0-test.37-6c30c79.apk`
- Taille : **47 106 028 octets**
- `package: name='com.souxch06.melodix' versionCode='45037' versionName='4.5.0-test.37' minSdk 23 targetSdk 34`
- **sha256 : `1075cc60b86f5a39f36bb46399293fd4fd51e658172cb78853e2bc56865c4cf2`**
  — **différent** de celui de la V49 (`8b8634a0…`) : les octets livrés ont bien changé.
- Annotation `JAMENDO-DIAG` (niveau **notice**) :
  _« source NON ARMÉE (aucun identifiant) — attendu et sans effet : l'APK fonctionne
  normalement, la recherche ignore Jamendo sans émettre de requête »_.

### 8.3 Ce qui n'a **PAS** été mesuré

- **Jamendo n'a jamais été interrogée.** `jamendo=0` est un **saut** (`skipped`), pas un
  résultat. Il n'existe **aucun identifiant valide** dans cet environnement et
  `api.jamendo.com` n'y est **pas joignable**.
- **Aucun gain de catalogue n'est annoncé.** Les cinq comparaisons exigées (résultats
  uniques, doublons inter-sources, pistes réellement jouables, erreurs/latence, recherches où
  Jamendo ajoute au moins un résultat utilisable) **n'ont pas été produites**.
- **Aucune validation audio sur appareil physique** : ni son audible, ni pause, ni
  notification, ni connexion n'ont été revalidés physiquement depuis la V38.

---

## 9. Limites et points ouverts

1. **Blocage contractuel (§3.3.1).** Le `client_id` embarqué contre la clause 2. **À lever par
   écrit auprès de Jamendo avant toute activation distribuée.**
2. **Version du texte.** Les conditions examinées datent du 17 septembre 2013 ; aucune version
   postérieure n'a pu être confirmée publiquement.
3. **Attribution absente de la liste de résultats.** Le lien d'origine n'est accessible que
   depuis le lecteur plein écran. `Search.tsx` ne transmet actuellement **aucun** `availability`
   à `SearchResultRow` : ajouter un badge Jamendo là aurait créé une asymétrie visible
   uniquement pour Jamendo. **Volontairement laissé en l'état** — à réévaluer si Jamendo
   précise la portée de la clause 4.1.
4. **Ouverture de lien non vérifiée sur appareil réel.** `Linking.openURL` est vérifié au
   niveau de l'appel ; le comportement réel du navigateur Android ne l'est pas.
5. **Rendu sur écran réel non vérifié.** Les tests valident la présence des éléments et leurs
   libellés, pas l'ergonomie perçue sur un téléphone.

---

## 10. Fichiers modifiés au commit `6c30c79`

| Fichier                                                        | Variation                                     |
| -------------------------------------------------------------- | --------------------------------------------- |
| `api/jamendo/attribution.ts`                                   | **+200** (nouveau)                            |
| `components/Player/JamendoAttribution.tsx`                     | **+119** (nouveau)                            |
| `components/Player/__tests__/jamendoAttribution.unit.test.tsx` | **+345** (nouveau)                            |
| `components/Player/__tests__/FullPlayer.unit.test.tsx`         | +124                                          |
| `api/jamendo/searchTracks.ts`                                  | +11 / −1 (constante `JAMENDO_UNKNOWN_ARTIST`) |
| `data/fr-fr.ts` / `data/en-gb.ts`                              | +8 / +8 (4 clés chacune)                      |
| `api/jamendo/index.ts`                                         | +7 (exports)                                  |
| `api/index.ts`                                                 | +4 (exports)                                  |
| `components/Player/FullPlayer.tsx`                             | +7 (câblage)                                  |
| **Total**                                                      | **10 fichiers, +832 / −1**                    |

**Aucun modèle partagé élargi. Aucun moteur audio, `PlayerContext`, MediaSession ou
notification modifié. Aucun identifiant intégré. Jamendo toujours désactivée par défaut.**
