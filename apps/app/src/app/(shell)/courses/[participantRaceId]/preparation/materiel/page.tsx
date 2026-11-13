import {
  DomainError,
  GEAR_CATEGORIES,
  getEquipmentChecklist,
  type OfficialEquipmentItem,
} from '@pluka/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  addFromLibraryAction,
  removePersonalEquipmentAction,
  setOfficialEquipmentAction,
  setPersonalEquipmentAction,
} from '@/app/(shell)/courses/[participantRaceId]/preparation/materiel/actions';
import { AddEquipmentForm } from '@/app/(shell)/courses/[participantRaceId]/preparation/materiel/add-equipment-form';
import { Icon } from '@/components/icon';
import { GEAR_CATEGORY_LABELS } from '@/lib/gear-categories';
import { preparationContext } from '@/lib/preparation';
import { requireSession } from '@/lib/session';

/**
 * Préparation · Matériel — 00_PRODUCT_SPEC §14.1, §14.2 ; prototype, `tab: 'prep'`.
 *
 * Deux listes distinctes : le matériel de l'organisation (avec son exigence et
 * un lien vers sa source), puis le matériel personnel. Cocher le matériel de
 * l'organisation est gratuit ; le matériel personnel demande le Race Pass, et
 * l'écran le dit au lieu de masquer la section (04 §45, §6.6).
 *
 * Les cases sont de vrais boutons de formulaire : elles marchent sans
 * JavaScript, et annoncent leur état (`aria-pressed`).
 */
export const metadata = { title: 'Matériel' };

const REQUIREMENT_LABELS = {
  mandatory: 'Obligatoire',
  conditional: 'Conditionnel',
  recommended: 'Recommandé',
} as const;

function requirementLabel(item: OfficialEquipmentItem): string {
  return item.requirement === null ? 'À préciser' : REQUIREMENT_LABELS[item.requirement];
}

function Check({ ready }: { readonly ready: boolean }) {
  return (
    <span className={ready ? 'eq-box eq-box-on' : 'eq-box'} aria-hidden="true">
      {ready ? <Icon name="Check" size={14} /> : null}
    </span>
  );
}

export default async function EquipmentPage({
  params,
}: {
  readonly params: Promise<{ readonly participantRaceId: string }>;
}) {
  const { participantRaceId } = await params;
  const session = await requireSession(`/courses/${participantRaceId}/preparation/materiel`);

  const checklist = await getEquipmentChecklist(preparationContext(session), {
    participantRaceId,
  }).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'not_found') notFound();
    throw error;
  });

  const { mandatory } = checklist;
  const left = mandatory.total - mandatory.ready;
  const percent = mandatory.total === 0 ? 0 : Math.round((mandatory.ready / mandatory.total) * 100);
  const sourceHref = `/courses/${participantRaceId}/course#rf-equipment`;

  return (
    <div className="eq-page">
      {/* Sans matériel obligatoire publié, une jauge « 0 / 0 » ne dirait rien. */}
      {mandatory.total === 0 ? null : (
        <section className="eq-summary" aria-labelledby="eq-gauge">
          <h1 id="eq-gauge" className="eq-gauge">
            {mandatory.ready} / {mandatory.total} prêts
          </h1>
          <div
            className="eq-bar"
            role="progressbar"
            aria-label="Matériel obligatoire prêt"
            aria-valuemin={0}
            aria-valuemax={mandatory.total}
            aria-valuenow={mandatory.ready}
          >
            <span style={{ width: `${String(percent)}%` }} />
          </div>
          {left === 0 ? (
            <p className="eq-notice eq-notice-done">
              <Icon name="Check" size={16} /> Tout le matériel obligatoire est prêt.
            </p>
          ) : (
            <p className="eq-notice">
              Il te reste {left} élément{left > 1 ? 's' : ''} obligatoire{left > 1 ? 's' : ''} à
              vérifier.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="eq-official-title">
        <h2 id="eq-official-title" className="eq-heading">
          Organisation · issu des informations officielles
        </h2>
        {checklist.official.length === 0 ? (
          <p className="eq-empty">
            L’organisation n’a pas encore publié de matériel pour cette épreuve. Il apparaîtra ici
            dès sa publication, avec sa source.
          </p>
        ) : (
          <ul className="eq-list">
            {checklist.official.map((item) => (
              <li key={item.raceFactId} className="eq-row">
                <form action={setOfficialEquipmentAction} className="eq-toggle">
                  <input type="hidden" name="participantRaceId" value={participantRaceId} />
                  <input type="hidden" name="raceFactId" value={item.raceFactId} />
                  <input type="hidden" name="ready" value={item.ready ? 'false' : 'true'} />
                  <button type="submit" className="eq-check" aria-pressed={item.ready}>
                    <Check ready={item.ready} />
                    <span className={item.ready ? 'eq-label eq-label-done' : 'eq-label'}>
                      {item.label}
                    </span>
                  </button>
                </form>
                <div className="eq-meta">
                  <span
                    className={
                      item.requirement === 'mandatory' ? 'eq-tag eq-tag-mandatory' : 'eq-tag'
                    }
                  >
                    {requirementLabel(item)}
                  </span>
                  {item.requirement === 'conditional' && item.condition !== null ? (
                    <span className="eq-condition">{item.condition}</span>
                  ) : null}
                  {item.detail === null ? null : <span className="eq-detail">{item.detail}</span>}
                </div>
                <Link href={sourceHref} className="eq-source">
                  Voir la source
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="eq-personal-title">
        <h2 id="eq-personal-title" className="eq-heading">
          Personnel
        </h2>
        {checklist.canEditPersonal ? (
          <>
            {checklist.personal.length === 0 ? (
              <p className="eq-empty">
                Ajoute ici ce que tu emportes en plus : bâtons, lunettes, batterie…
              </p>
            ) : (
              <ul className="eq-list">
                {checklist.personal.map((item) => (
                  <li key={item.id} className="eq-row">
                    <form action={setPersonalEquipmentAction} className="eq-toggle">
                      <input type="hidden" name="participantRaceId" value={participantRaceId} />
                      <input type="hidden" name="equipmentId" value={item.id} />
                      <input type="hidden" name="ready" value={item.ready ? 'false' : 'true'} />
                      <button type="submit" className="eq-check" aria-pressed={item.ready}>
                        <Check ready={item.ready} />
                        <span className={item.ready ? 'eq-label eq-label-done' : 'eq-label'}>
                          {item.label}
                        </span>
                      </button>
                    </form>
                    <form action={removePersonalEquipmentAction} className="eq-remove">
                      <input type="hidden" name="participantRaceId" value={participantRaceId} />
                      <input type="hidden" name="equipmentId" value={item.id} />
                      <button type="submit" aria-label={`Retirer ${item.label}`}>
                        <Icon name="X" size={16} />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <AddEquipmentForm
              participantRaceId={participantRaceId}
              savesToLibrary={checklist.savesToLibrary}
            />

            {/* « Mon matériel » pas encore dans cette course : un clic par pièce. */}
            {checklist.fromLibrary.length === 0 ? null : (
              <div className="eq-from-library">
                <div className="eq-from-library-head">
                  <h3 className="eq-heading">Depuis mon matériel</h3>
                  <form action={addFromLibraryAction}>
                    <input type="hidden" name="participantRaceId" value={participantRaceId} />
                    {checklist.fromLibrary.map((item) => (
                      <input key={item.id} type="hidden" name="itemId" value={item.id} />
                    ))}
                    <button type="submit" className="eq-add-all">
                      Tout ajouter ({checklist.fromLibrary.length})
                    </button>
                  </form>
                </div>
                {GEAR_CATEGORIES.map((category) => {
                  const items = checklist.fromLibrary.filter((item) => item.category === category);
                  if (items.length === 0) return null;
                  return (
                    <div key={category} className="eq-chip-group">
                      <p className="eq-chip-group-title">{GEAR_CATEGORY_LABELS[category]}</p>
                      <ul className="eq-chips">
                        {items.map((item) => (
                          <li key={item.id}>
                            <form action={addFromLibraryAction}>
                              <input
                                type="hidden"
                                name="participantRaceId"
                                value={participantRaceId}
                              />
                              <input type="hidden" name="itemId" value={item.id} />
                              <button
                                type="submit"
                                aria-label={`Ajouter ${item.label} à cette course`}
                              >
                                + {item.label}
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="eq-locked">
            <p>
              Ajoute ton propre matériel — bâtons, lunettes, batterie — et coche-le au fil de ta
              préparation. Le matériel personnel fait partie de la préparation complète.
            </p>
            <Link
              href={`/offre?course=${participantRaceId}`}
              className="pk-btn pk-button-secondary"
            >
              Voir le Race Pass
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
