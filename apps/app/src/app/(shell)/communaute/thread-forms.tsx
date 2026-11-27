'use client';

import {
  COMMUNITY_BODY_MAX,
  COMMUNITY_REPORT_DETAILS_MAX,
  COMMUNITY_REPORT_REASONS,
} from '@pluka/domain';
import { useActionState, useEffect, useState } from 'react';

import {
  replyToCommunityThreadAction,
  reportCommunityContentAction,
  type CommunityFormState,
} from '@/app/(shell)/communaute/actions';
import { CommunityEditor } from '@/components/community-editor';
import { Icon } from '@/components/icon';
import { COMMUNITY_REPORT_REASON_LABELS } from '@/lib/community-format';

const INITIAL: CommunityFormState = {};

/**
 * Répondre au sujet. Une réponse publiée remet l'éditeur à neuf (une nouvelle
 * clé le recrée vide) ; un refus le laisse tel quel, texte compris.
 */
export function ReplyForm({ threadId }: { readonly threadId: string }) {
  const [state, reply, pending] = useActionState(replyToCommunityThreadAction, INITIAL);
  const [published, setPublished] = useState(0);
  const error = state.fieldErrors?.body ?? state.error;

  useEffect(() => {
    if (state.saved === true) setPublished((count) => count + 1);
  }, [state]);

  return (
    <form action={reply} className="cm-reply">
      <input type="hidden" name="threadId" value={threadId} />
      <CommunityEditor
        key={published}
        name="body"
        label="Ta réponse"
        placeholder="Répondre à cette discussion…"
        maxLength={COMMUNITY_BODY_MAX}
        required
        rows={3}
        error={error}
        defaultValue={state.values?.body}
      />
      <button type="submit" className="pk-btn pk-button-primary" disabled={pending}>
        {pending ? 'Publication…' : 'Répondre'}
      </button>
    </form>
  );
}

/**
 * Signaler un sujet ou une réponse : un motif, un mot facultatif. Replié tant
 * qu'on ne l'ouvre pas ; la modération de l'édition le reçoit (0114).
 */
export function ReportForm({
  threadId,
  postId,
}: {
  readonly threadId: string;
  readonly postId?: string | undefined;
}) {
  const [state, report, pending] = useActionState(reportCommunityContentAction, INITIAL);
  const id = postId ?? threadId;

  if (state.saved === true) {
    return (
      <p className="cm-reported" role="status">
        <Icon name="Check" size={16} />
        Merci, la modération va vérifier.
      </p>
    );
  }

  return (
    <details className="cm-disclosure">
      <summary className="cm-gesture">
        <Icon name="Flag" size={16} />
        Signaler
      </summary>
      <form action={report} className="cm-disclosure-body">
        <input type="hidden" name="threadId" value={threadId} />
        {postId === undefined ? null : <input type="hidden" name="postId" value={postId} />}
        <fieldset className="cm-fieldset">
          <legend className="pk-label">Pourquoi ?</legend>
          {COMMUNITY_REPORT_REASONS.map((reason) => (
            <label key={reason} className="cm-radio">
              <input
                type="radio"
                name="reason"
                value={reason}
                required
                defaultChecked={state.values?.reason === reason}
              />
              {COMMUNITY_REPORT_REASON_LABELS[reason]}
            </label>
          ))}
        </fieldset>
        <label htmlFor={`cm-report-${id}`} className="pk-label">
          Un mot pour la modération (facultatif)
        </label>
        <textarea
          id={`cm-report-${id}`}
          name="details"
          className="cm-input"
          rows={2}
          maxLength={COMMUNITY_REPORT_DETAILS_MAX}
          defaultValue={state.values?.details ?? ''}
        />
        {state.error === undefined ? null : (
          <p className="pk-field-error" role="alert">
            {state.fieldErrors?.reason ?? state.error}
          </p>
        )}
        <button type="submit" className="pk-btn pk-button-secondary" disabled={pending}>
          Envoyer le signalement
        </button>
      </form>
    </details>
  );
}
