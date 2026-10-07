'use client';

import { useActionState } from 'react';

import { importNutritionCatalogueAction, type ImportState } from '@/app/nutrition-actions';

const INITIAL: ImportState = {};

/**
 * Import du catalogue — migration 0039. Le compte rendu revient au
 * formulaire : créées, mises à jour, rejetées avec leur ligne et leur raison,
 * avertissements (tags écartés, texture inconnue).
 */
export function ImportForm() {
  const [state, action, pending] = useActionState(importNutritionCatalogueAction, INITIAL);
  const report = state.report;

  return (
    <>
      <form action={action} className="ad-team-invite">
        <div className="pk-field">
          <label className="pk-field-label" htmlFor="import-file">
            Fichier CSV
          </label>
          <input
            id="import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="pk-input"
          />
          <p className="pk-field-hint">
            Séparateur point-virgule ou virgule, encodage UTF-8. Une fiche est reconnue par sa
            marque, son nom et sa saveur : réimporter met à jour, sans dupliquer.
          </p>
        </div>
        <div>
          <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
            {pending ? 'Import en cours…' : 'Importer'}
          </button>
        </div>
        {state.error === undefined ? null : (
          <p className="pk-field-error" role="alert">
            {state.fieldErrors?.['csv'] ?? state.error}
          </p>
        )}
      </form>

      {report === undefined ? null : (
        <section className="ad-org-panel" aria-labelledby="import-report" role="status">
          <h2 id="import-report" className="ad-org-panel-title">
            Compte rendu
          </h2>
          <ul className="ad-org-tiles">
            <li className="ad-org-tile">
              <span className="ad-org-tile-label">Créées</span>
              <span className="ad-org-tile-value">{report.created}</span>
            </li>
            <li className="ad-org-tile">
              <span className="ad-org-tile-label">Mises à jour</span>
              <span className="ad-org-tile-value">{report.updated}</span>
            </li>
            <li className="ad-org-tile">
              <span className="ad-org-tile-label">Rejetées</span>
              <span className="ad-org-tile-value">{report.rejected.length}</span>
              <span className="ad-org-tile-meta">à corriger dans le fichier, puis réimporter</span>
            </li>
          </ul>

          {report.rejected.length === 0 ? null : (
            <>
              <h3 className="ad-org-subtitle">Lignes rejetées</h3>
              <ul className="ad-rows">
                {report.rejected.map((row) => (
                  <li key={row.line} className="ad-row">
                    <div className="ad-row-main">
                      <span className="ad-row-title">
                        Ligne {row.line} — {row.name || 'sans nom'}
                      </span>
                      <span className="ad-row-meta">{row.reasons.join(' · ')}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {report.warnings.length === 0 ? null : (
            <>
              <h3 className="ad-org-subtitle">Avertissements</h3>
              <ul className="ad-rows">
                {report.warnings.map((warning, index) => (
                  <li key={`${warning.line}-${index}`} className="ad-row">
                    <span className="ad-row-meta">
                      Ligne {warning.line} — {warning.message}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
