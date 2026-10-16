declare module '*.svg';
declare module '*.jpg';
declare module '*.png';
declare module '*.otf';
declare module '*.mp3';

/**
 * xml2js (dépendance transitive de @expo/config-plugins) : types minimaux
 * pour les tests des config plugins Node — jamais utilisé dans le bundle
 * React Native.
 */
declare module 'xml2js' {
  export function parseStringPromise(xml: string): Promise<unknown>;
  export class Builder {
    buildObject(obj: unknown): Promise<string>;
  }
}
