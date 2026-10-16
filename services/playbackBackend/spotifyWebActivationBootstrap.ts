/**
 * ACTIVATION DE PRODUCTION — Spotify Web Player comme source audio des
 * pistes Spotify (Mission v7), corrigée par l'audit Mission V21.
 *
 * CE QU'IL RESTE (activation technique) :
 *  - le flag local est levé au démarrage, à la racine de l'app
 *    (`app/_layout.tsx`), jamais dans le moteur ;
 *  - la fonction est IDEMPOTENTE (deux appels = un effet) ;
 *  - elle ne touche NI la WebView, NI un cookie, NI un token : c'est une
 *    décision d'activation, pas une action de lecture ;
 *  - la lecture Spotify Web ne produit un `playing` moteur QUE sur un état
 *    `playing` PUBLIÉ par la page (bonne piste, bonne session) — le flag
 *    n'autorise que l'ESSAI, jamais la déclaration de lecture.
 *
 * CE QUI A ÉTÉ SUPPRIMÉ (audit V21 — incohérence corrigée) :
 *  - l'ancienne version consignait AUTOMATIQUEMENT
 *    `recordSpotifyWebPhysicalValidation(true, <chaîne prédéfinie>)` —
 *    « phone-run 2026-10-07 : lecture réelle audible … ». Une chaîne de
 *    texte dans le code ne constitue pas une preuve d'exécution d'un test
 *    physique. Aucun compte rendu fiable ne figure dans le dépôt :
 *    · le rapport V10 du même jour (build 45014) consigne « validation
 *      physique NON exécutable depuis ce sandbox » et sa section
 *      « TESTÉ PHYSIQUEMENT » est explicitement VIDE ;
 *    · le rapport « premier test réel Spotify » (build 45015, même jour)
 *      dit « le code est PRÊT pour le premier test Spotify réel » ;
 *    · la référence CI (run 37577095621) existe et est SUCCESS, mais son
 *      head (`f821485`) est un build v6 ANTÉRIEUR à l'intégration du
 *      lecteur — sa smoke ne testait pas la MediaSession du lecteur.
 *  - le statut de validation physique repart donc honnêtement à
 *    `NOT_TESTED` et n'est levé que par la consigne UTILISATEUR
 *    (Réglages → Lecture Spotify Web → « Consigner PASSED (preuve
 *    ci-dessus) »), qui reste le mécanisme prévu : preuve documentée
 *    non vide exigée, jamais de booléen seul.
 *
 * Séparation des trois états (contractuelle, testée) :
 *  1. activation technique du moteur (ce module) ;
 *  2. validation physique de l'appareil (`NOT_TESTED`/`PASSED_ON_DEVICE`,
 *     affichée dans l'UI, non bloquante) ;
 *  3. confirmation réelle de lecture (état publié par la page — moteur).
 *
 * Ne PAS réintroduire de consigne automatique : si un test physique réel
 * a lieu, il doit être consigné depuis l'UI avec sa preuve, et consigné
 * dans `docs/SPOTIFY-WEB-PHYSICAL-TEST.md` (table de résultats remplie).
 */
import { setSpotifyWebPlaybackEnabled } from './spotifyWebFeature';

/**
 * Lève l'activation TECHNIQUE en production (idempotent).
 *
 * À appeler UNE fois au démarrage, avant tout rendu qui consulte la porte
 * (la racine de l'app — `app/_layout.tsx`). Ne prouve en soi AUCUNE lecture
 * d'une piste précise et ne consigne AUCUNE validation physique : le statut
 * physique reste `NOT_TESTED` tant qu'un compte rendu réel n'a pas été
 * consigné par l'utilisateur.
 */
export const ensureProductionSpotifyWebActivation = (): void => {
  setSpotifyWebPlaybackEnabled(true);
};
