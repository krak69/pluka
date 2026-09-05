/**
 * Version du processeur GPX.
 *
 * Persistée dans `race_course_geometries.processor_version` (02_DATA_MODEL
 * §6.8). Elle rend une géométrie reproductible : deux traces produites par la
 * même version à partir du même fichier sont identiques, et un changement de
 * constante impose une nouvelle version plutôt qu'une réécriture silencieuse
 * de l'existant (01_ARCHITECTURE §30).
 *
 * À incrémenter dès qu'une constante de prétraitement ou une règle de
 * nettoyage change.
 */
export const PROCESSOR_VERSION = 'gpx-1.0.0';

/**
 * Constantes de prétraitement — docs/engines/PLAN_ENGINE.md §8.1.
 *
 * « Les valeurs 50 m / 25 m / 100 m sont des constantes de preprocessing V1 et
 * doivent rester configurables/versionnées. »
 *
 * Ce lot n'implémente que le lissage : le ré-échantillonnage et les
 * micro-segments appartiennent au moteur Plan, qui consomme cette trace
 * normalisée.
 */
export const PREPROCESSING = {
  /** Fenêtre horizontale de lissage de l'altitude, en mètres (§8.1 étape 4). */
  elevationSmoothingWindowMeters: 50,
} as const;

/**
 * Seuils de contrôle qualité — docs/engines/PLAN_ENGINE.md §9.
 *
 * Ils produisent un verdict, jamais une correction : « le moteur ne falsifie
 * pas le GPX, il ne modifie pas artificiellement le D+ » (§9.1).
 */
export const QUALITY = {
  /** Au-delà, le parcours n'est pas éligible au modèle relief V1. */
  maxMissingElevationRatio: 0.05,
  /** Pente brute considérée comme extrême. Le signal est conservé, pas corrigé. */
  extremeGradeRatio: 0.6,
} as const;

/**
 * Seuils de nettoyage (§8.1 étape 2 : « supprimer les doublons évidents et
 * points aberrants manifestes »).
 *
 * « Manifeste » est le mot important : on retire ce qui ne peut pas être un
 * déplacement réel, pas ce qui semble improbable. Un ultra comporte des
 * arrêts longs et des sections très lentes ; un filtre agressif effacerait du
 * signal.
 */
export const CLEANING = {
  /** Deux points plus proches que cela sont un doublon de capture. */
  duplicateDistanceMeters: 0.5,
  /**
   * Saut horizontal au-delà duquel un point est tenu pour aberrant.
   *
   * 5 km entre deux points consécutifs : aucune trace pédestre ne le produit,
   * c'est une erreur de capture ou une concaténation de fichiers.
   */
  maxJumpMeters: 5000,
  /** Altitudes hors de cette plage ne sont pas terrestres. */
  minElevationMeters: -500,
  maxElevationMeters: 9000,
} as const;
