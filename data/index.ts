import {
  EN_GB,
  EN_GB_ACCOUNT,
  EN_GB_HOME,
  EN_GB_LOGIN,
  EN_GB_PLAYER,
  EN_GB_PLAYLIST,
  EN_GB_SETTINGS,
} from './en-gb';
import {
  FR_FR_ACCOUNT,
  FR_FR_HOME,
  FR_FR_LOGIN,
  FR_FR_PLAYER,
  FR_FR_PLAYLIST,
  FR_FR_SEARCH,
  FR_FR_SETTINGS,
} from './fr-fr';

// La base de l'interface est en anglais (en-gb.ts) ; les messages critiques
// (connexion, compte, lecteur, erreurs utilisateur) sont surchargés en
// français. EN_GB_LOGIN fournit les reprises anglaises si besoin futur.
export * from './genres';
export const translations = {
  ...EN_GB,
  ...EN_GB_ACCOUNT,
  ...EN_GB_HOME,
  ...EN_GB_LOGIN,
  ...EN_GB_PLAYER,
  ...EN_GB_PLAYLIST,
  ...EN_GB_SETTINGS,
  ...FR_FR_ACCOUNT,
  ...FR_FR_HOME,
  ...FR_FR_SEARCH,
  ...FR_FR_PLAYER,
  ...FR_FR_LOGIN,
  ...FR_FR_PLAYLIST,
  ...FR_FR_SETTINGS,
};

/** Type du dictionnaire complet (base EN + surcharges FR). */
export type Translations = typeof translations;
