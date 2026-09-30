import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ADMIN_NAV, isCurrent } from '@/components/admin-nav';
import {
  AdminStatus,
  entitlementLabel,
  platformRoleLabel,
  productCategoryLabel,
  reportReason,
  sourceTypeLabel,
  statusLabel,
} from '@/components/admin-status';

/**
 * Console d'administration — lot 4a.
 *
 * Deux choses se vérifient ici, et elles se sont toutes les deux déjà trompées
 * pendant l'écriture de ce lot :
 *
 * 1. **Les libellés de statut contre les enums réels.** J'avais écrit
 *    `pilot`, `needs_review`, `ready` là où la base dit `prospect`,
 *    `detected`, `processed`. Rien ne le signalait : une clé absente rend
 *    simplement la valeur brute, et l'écran affichait `prospect` en anglais
 *    sans échouer. Le test relit les enums dans la migration 0001 et compare.
 *
 * 2. **L'onglet actif.** `/` doit s'allumer pour l'index sans s'allumer
 *    partout : c'est le défaut classique d'un `startsWith` appliqué à la
 *    racine.
 */

const MIGRATIONS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
);

const SCHEMA = readFileSync(resolve(MIGRATIONS, '0001_initial_schema.sql'), 'utf8');

/** Valeurs déclarées par `create type … as enum (…)`. */
function enumValues(name: string): readonly string[] {
  const pattern = new RegExp(String.raw`create type public\.${name} as enum \(([^)]+)\)`, 'i');
  const match = pattern.exec(SCHEMA);

  expect(match, `enum ${name} introuvable dans 0001`).not.toBeNull();

  return [...((match as RegExpExecArray)[1] as string).matchAll(/'([^']+)'/g)].map(
    (value) => value[1] as string,
  );
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe('libellés de statut', () => {
  /*
   * Chaque valeur de chaque enum a un libellé, et ce libellé n'est pas la
   * valeur brute. C'est exactement ce qui manquait quand j'avais inventé
   * `pilot` : `statusLabel('organization', 'prospect')` rendait `prospect`.
   */
  const ENUM_DOMAINS = [
    { domain: 'organization', enumName: 'organization_status' },
    { domain: 'source', enumName: 'source_status' },
    { domain: 'product', enumName: 'nutrition_product_status' },
    { domain: 'report', enumName: 'report_status' },
  ] as const;

  it('couvre tous les statuts d’organisation, de source, de produit et de signalement', () => {
    for (const { domain, enumName } of ENUM_DOMAINS) {
      for (const value of enumValues(enumName)) {
        expect(statusLabel(domain, value), `${domain} / ${value} sans libellé`).not.toBe(value);
      }
    }
  });

  it('couvre les statuts de traitement, de candidat et de conflit', () => {
    // Ces trois-là vivent en `text` avec une contrainte `check`, pas en enum :
    // les valeurs sont donc écrites ici, et `n'invente aucun statut` ne peut
    // pas les recouper. Elles viennent de `private.ingestion_jobs`,
    // `private.fact_candidates` et `private.conflict_reports` (0001).
    for (const value of ['queued', 'running', 'completed', 'failed', 'cancelled']) {
      expect(statusLabel('job', value)).not.toBe(value);
    }

    for (const value of ['detected', 'accepted', 'rejected', 'conflict']) {
      expect(statusLabel('candidate', value)).not.toBe(value);
    }

    for (const value of ['open', 'resolved', 'dismissed']) {
      expect(statusLabel('conflict', value)).not.toBe(value);
    }
  });

  it('n’invente aucun statut que la base ne connaît pas', () => {
    // Le symétrique du test précédent, et le plus utile des deux : un libellé
    // pour un statut inexistant est une promesse d'écran que rien ne tiendra.
    for (const { domain, enumName } of ENUM_DOMAINS) {
      const values = enumValues(enumName);

      for (const invented of ['pilot', 'needs_review', 'processed', 'validated_by_admin']) {
        if (values.includes(invented)) continue;

        expect(
          statusLabel(domain, invented),
          `${domain} / ${invented} n'existe pas en base mais porte un libellé`,
        ).toBe(invented);
      }
    }
  });

  it('couvre les motifs de signalement, les types de source et les catégories de produit', () => {
    for (const reason of enumValues('report_reason')) {
      expect(reportReason(reason), `motif ${reason} sans libellé`).not.toBe(reason);
    }

    for (const type of enumValues('source_type')) {
      expect(sourceTypeLabel(type), `type ${type} sans libellé`).not.toBe(type);
    }

    for (const category of enumValues('nutrition_product_category')) {
      expect(productCategoryLabel(category), `catégorie ${category} sans libellé`).not.toBe(
        category,
      );
    }
  });

  it('couvre les deux rôles plateforme, et seulement eux', () => {
    const roles = enumValues('platform_role');

    expect(roles).toEqual(['user', 'pluka_admin']);

    for (const role of roles) {
      expect(platformRoleLabel(role)).not.toBe(role);
    }

    // `organizer` n'est pas un rôle plateforme : l'appartenance à une
    // organisation vit dans `organization_members` (§4.1).
    expect(platformRoleLabel('organizer')).toBe('organizer');
  });

  it('couvre les quatre niveaux de droit de 04_ENTITLEMENTS', () => {
    for (const level of ['free', 'race_pass', 'organizer_included', 'plus']) {
      expect(entitlementLabel(level), `niveau ${level} sans libellé`).not.toBe(level);
    }
  });

  it('rend une valeur inconnue plutôt que de la taire', () => {
    // Un enum élargi par une migration future doit se voir à l'écran. Rendre
    // une pastille vide serait la pire des trois réponses possibles.
    const markup = render(<AdminStatus domain="organization" status="federated" />);

    expect(markup).toContain('federated');
  });
});

describe('navigation', () => {
  it('porte les dix destinations du prototype', () => {
    expect(ADMIN_NAV).toHaveLength(10);

    // `/courses/[raceId]` n'en fait pas partie : l'administration d'une épreuve
    // se rejoint par Événements → événement → épreuve, et `adminNav` ne change
    // pas (décision du lot 4).
    expect(ADMIN_NAV.map((destination) => destination.href)).not.toContain('/courses');
  });

  it('n’allume la racine que sur la racine', () => {
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/journal', '/')).toBe(false);
    expect(isCurrent('/utilisateurs/abc', '/')).toBe(false);
  });

  it('allume Événements sur une fiche d’événement', () => {
    // La liste vit à `/` et les fiches sous `/evenements/…` : sans ce cas,
    // ouvrir un événement éteindrait l'onglet dont on vient.
    expect(isCurrent('/evenements/7f1a', '/')).toBe(true);
  });

  it('allume un onglet sur ses sous-chemins, pas sur un voisin homographe', () => {
    expect(isCurrent('/utilisateurs/7f1a', '/utilisateurs')).toBe(true);
    expect(isCurrent('/produits/a-verifier', '/produits')).toBe(true);

    // `/signalements` ne doit pas allumer `/signalement` ni l'inverse : le
    // préfixe est testé avec sa barre.
    expect(isCurrent('/signalementsX', '/signalements')).toBe(false);
  });

  it('n’allume qu’une destination à la fois', () => {
    for (const pathname of [
      '/',
      '/vue-d-ensemble',
      '/validation',
      '/organisations',
      '/sources',
      '/produits/catalogue',
      '/signalements/7f1a',
      '/utilisateurs',
      '/traitements',
      '/journal',
    ]) {
      const lit = ADMIN_NAV.filter((destination) => isCurrent(pathname, destination.href));

      expect(
        lit.map((destination) => destination.href),
        `${pathname} allume plusieurs onglets`,
      ).toHaveLength(1);
    }
  });
});
