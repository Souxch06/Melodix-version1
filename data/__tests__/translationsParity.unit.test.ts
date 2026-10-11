import {
  EN_GB,
  EN_GB_ACCOUNT,
  EN_GB_HOME,
  EN_GB_LOGIN,
  EN_GB_PLAYER,
  EN_GB_PLAYLIST,
  EN_GB_SETTINGS,
} from '../en-gb';
import {
  FR_FR_ACCOUNT,
  FR_FR_HOME,
  FR_FR_LOGIN,
  FR_FR_PLAYER,
  FR_FR_PLAYLIST,
  FR_FR_SEARCH,
  FR_FR_SETTINGS,
} from '../fr-fr';

/**
 * Mission V35 — parité des textes FR/EN.
 *
 * L'interface est construite sur la base ANGLAISE (en-gb.ts), les messages
 * critiques étant SURCHARGÉS en français (fr-fr.ts). Deux défauts possibles
 * sont testés ici parce qu'ils cassent l'interface réelle :
 *   1. une clé FR orpheline (surchargée mais absente de la base EN) —
 *      l'anglais afficherait `undefined` ;
 *   2. une divergence de nature (fonction vs chaîne) ou d'arité entre la
 *      surcharge FR et la base EN — l'appel `translations.x(...)` planterait
 *      dans une langue ou produirait un message tronqué dans l'autre.
 */
const EN_BASE: Record<string, unknown> = {
  ...EN_GB,
  ...EN_GB_ACCOUNT,
  ...EN_GB_HOME,
  ...EN_GB_LOGIN,
  ...EN_GB_PLAYER,
  ...EN_GB_PLAYLIST,
  ...EN_GB_SETTINGS,
};

const FR_GROUPS: Record<string, Record<string, unknown>> = {
  FR_FR_ACCOUNT,
  FR_FR_HOME,
  FR_FR_LOGIN,
  FR_FR_PLAYER,
  FR_FR_PLAYLIST,
  FR_FR_SEARCH,
  FR_FR_SETTINGS,
};

describe('traductions — parité FR/EN', () => {
  const orphans: string[] = [];
  const typeMismatches: string[] = [];
  const arityMismatches: string[] = [];

  for (const [groupName, dict] of Object.entries(FR_GROUPS)) {
    for (const [key, value] of Object.entries(dict)) {
      if (!(key in EN_BASE)) {
        orphans.push(`${groupName}.${key}`);
        continue;
      }
      const enValue = EN_BASE[key];
      const frIsFn = typeof value === 'function';
      const enIsFn = typeof enValue === 'function';
      if (frIsFn !== enIsFn) {
        typeMismatches.push(
          `${groupName}.${key} (fr=${frIsFn ? 'fn' : 'str'}, en=${
            enIsFn ? 'fn' : 'str'
          })`
        );
        continue;
      }
      if (
        frIsFn &&
        enIsFn &&
        (value as (...args: unknown[]) => unknown).length !==
          (enValue as (...args: unknown[]) => unknown).length
      ) {
        arityMismatches.push(`${groupName}.${key}`);
      }
    }
  }

  it('aucune surcharge FR orpheline (la clé existe dans la base EN)', () => {
    expect(orphans).toEqual([]);
  });

  it('aucune divergence de nature fonction/chaîne entre FR et EN', () => {
    expect(typeMismatches).toEqual([]);
  });

  it('aucune divergence d arité sur les messages paramétrés', () => {
    expect(arityMismatches).toEqual([]);
  });

  it('les messages critiques du lecteur existent en FR', () => {
    const critical = [
      'playerError',
      'playerUnavailable',
      'playerTrackUnavailable',
      'playerTrackPlayFailed',
      'playerQueueEmpty',
      'playerResumeTitle',
    ];
    for (const key of critical) {
      expect(FR_FR_PLAYER).toHaveProperty(key);
    }
  });

  it('aucun texte vide dans la base EN ni dans les surcharges FR', () => {
    const empties: string[] = [];
    for (const [key, value] of Object.entries(EN_BASE)) {
      if (typeof value === 'string' && value.trim() === '') {
        empties.push(`EN.${key}`);
      }
    }
    for (const [groupName, dict] of Object.entries(FR_GROUPS)) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'string' && value.trim() === '') {
          empties.push(`${groupName}.${key}`);
        }
      }
    }
    expect(empties).toEqual([]);
  });
});
