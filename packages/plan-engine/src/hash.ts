import { createHash } from 'node:crypto';

import type { PlanCalculationInput } from './contracts.js';

/**
 * Hash d'entrée — docs/engines/PLAN_ENGINE.md §34.
 *
 * « La reproductibilité exige un `input_hash`. […] Même input logique + même
 * version moteur = même hash. »
 *
 * Méthode de référence, dans l'ordre de §34 :
 *
 * 1. payload logique sans données volatiles ;
 * 2. clés ordonnées canoniquement ;
 * 3. ordre métier conservé là où il a du sens ;
 * 4. nombres normalisés ;
 * 5. sérialisation UTF-8 ;
 * 6. SHA-256 ;
 * 7. hex de 64 caractères.
 *
 * Ce qui n'entre pas dans le hash : `calculatedAt`, request id, métriques de
 * performance, valeurs UI, ordre non sémantique. Aucune de ces valeurs
 * n'existe d'ailleurs dans l'entrée — c'est plus sûr que de devoir les
 * exclure.
 *
 * `node:crypto` est un module de plate-forme, pas une dépendance : §28 exclut
 * React, Next.js, Supabase, le réseau et l'IA, pas la bibliothèque standard.
 * Le hash reste une fonction pure des octets qu'on lui donne.
 */

/**
 * Normalisation numérique — §34, étape 4.
 *
 * `-0` et `0` sont le même nombre logique mais deux littéraux JSON différents.
 * Sans cette normalisation, deux entrées identiques produiraient deux hashes.
 */
function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('valeur numérique non finie : le hash serait ambigu');
  }

  return value === 0 ? 0 : value;
}

/**
 * Sérialisation canonique.
 *
 * Les clés d'objet sont triées — leur ordre n'a aucun sens métier. Les
 * tableaux, eux, conservent le leur : §34, étape 3, « conserver l'ordre métier
 * des tableaux là où il a du sens ». Un parcours n'est pas un ensemble.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return JSON.stringify(normalizeNumber(value));
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
  }

  throw new Error(`type non sérialisable dans le hash : ${typeof value}`);
}

/**
 * Payload logique du hash.
 *
 * Les collections sont triées par leur ordre métier — `sortOrder` pour le
 * parcours, identifiant pour les contraintes, dont l'ordre de saisie ne veut
 * rien dire. §35 : « les collections sont triées explicitement avant calcul ».
 */
function hashPayload(input: PlanCalculationInput): unknown {
  const bySortOrder = <T extends { sortOrder: number }>(items: readonly T[]): readonly T[] =>
    [...items].sort((left, right) => left.sortOrder - right.sortOrder);

  const byId = <T extends { readonly [key in K]: string }, K extends string>(
    items: readonly T[],
    key: K,
  ): readonly T[] => [...items].sort((left, right) => left[key].localeCompare(right[key]));

  return {
    race: { id: input.race.id, startAt: input.race.startAt, timezone: input.race.timezone },
    engine: {
      engineVersion: input.engineConfig.engineVersion,
      preprocessingVersion: input.course.preprocessingVersion,
    },
    mode: input.mode,
    targetDurationSeconds: input.targetDurationSeconds,
    waypoints: bySortOrder(input.course.waypoints).map((waypoint) => ({
      id: waypoint.id,
      sortOrder: waypoint.sortOrder,
    })),
    raceSegments: bySortOrder(input.course.raceSegments).map((segment) => ({
      id: segment.id,
      sortOrder: segment.sortOrder,
      fromWaypointId: segment.fromWaypointId,
      toWaypointId: segment.toWaypointId,
    })),
    microSegments: bySortOrder(input.course.microSegments).map((micro) => ({
      id: micro.id,
      raceSegmentId: micro.raceSegmentId,
      sortOrder: micro.sortOrder,
      distanceMeters: micro.distanceMeters,
      modelGrade: micro.modelGrade,
      progress: micro.progress,
      technicality: micro.technicality,
    })),
    cutoffs: byId(input.course.cutoffs, 'id').map((cutoff) => ({
      id: cutoff.id,
      waypointId: cutoff.waypointId,
      cutoffElapsedSeconds: cutoff.cutoffElapsedSeconds,
      basis: cutoff.basis,
    })),
    stops: byId(input.stops, 'waypointId'),
    segmentOverrides: byId(input.segmentOverrides, 'segmentId'),
    anchors: byId(input.anchors, 'waypointId'),
  };
}

export function computeInputHash(input: PlanCalculationInput): string {
  return createHash('sha256')
    .update(canonicalize(hashPayload(input)), 'utf8')
    .digest('hex');
}
