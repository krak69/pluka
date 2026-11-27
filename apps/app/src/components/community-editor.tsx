'use client';

import { ListItem, ListKeymap } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Icon, type IconName } from '@/components/icon';
import { safeHref, serializeCommunityDoc } from '@/lib/community-text';

/**
 * Éditeur des messages de la Communauté — décision produit du 2026-11-27 :
 * gras, italique, listes, citations, liens https.
 *
 * Il écrit le Markdown restreint de `community-text` dans un champ caché : le
 * formulaire poste du texte, jamais du HTML. Tant que JavaScript n'a pas pris
 * la main, un champ de texte ordinaire porte le même nom ; le message s'écrit
 * alors sans mise en forme, et s'affiche quand même.
 *
 * Tab n'imbrique pas les listes : il quitte l'éditeur, comme dans tout champ
 * (WCAG 2.1.2, pas de piège au clavier). Le texte affiché reste à plat.
 */

const FlatListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitListItem(this.name) };
  },
});

const ListKeymapWithoutTab = ListKeymap.extend({
  addKeyboardShortcuts() {
    const inherited = this.parent?.() ?? {};
    return Object.fromEntries(Object.entries(inherited).filter(([key]) => key !== 'Tab'));
  },
});

interface Format {
  readonly key: 'bold' | 'italic' | 'bulletList' | 'orderedList' | 'blockquote';
  readonly label: string;
  readonly icon: IconName;
  readonly run: (editor: Editor) => void;
}

const FORMATS: readonly Format[] = [
  {
    key: 'bold',
    label: 'Gras',
    icon: 'TextB',
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    label: 'Italique',
    icon: 'TextItalic',
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    key: 'bulletList',
    label: 'Liste à puces',
    icon: 'ListBullets',
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'orderedList',
    label: 'Liste numérotée',
    icon: 'ListNumbers',
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    key: 'blockquote',
    label: 'Citation',
    icon: 'Quotes',
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
];

/** L'adresse saisie, en https ; une adresse sans protocole le reçoit. */
function linkFromDraft(draft: string): { readonly href: string } | { readonly error: string } {
  const value = draft.trim();
  if (value === '') return { error: 'Colle une adresse.' };
  if (/^http:\/\//iu.test(value)) return { error: 'Seuls les liens https sont acceptés.' };
  const href = safeHref(/^[a-z][a-z0-9+.-]*:/iu.test(value) ? value : `https://${value}`);
  return href === null ? { error: 'Cette adresse n’est pas valide.' } : { href };
}

export interface CommunityEditorProps {
  /** Nom du champ posté. */
  readonly name: string;
  readonly label: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly required?: boolean;
  /** Message d'erreur rattaché au champ, s'il y en a un. */
  readonly error?: string | undefined;
  readonly rows?: number;
  /** La saisie refusée, rendue au champ de texte quand JavaScript est coupé. */
  readonly defaultValue?: string | undefined;
}

export function CommunityEditor({
  name,
  label,
  placeholder,
  maxLength,
  required = false,
  error,
  rows = 5,
  defaultValue,
}: CommunityEditorProps) {
  const base = useId();
  const labelId = `${base}-label`;
  const fieldId = `${base}-field`;
  const errorId = `${base}-error`;
  const linkInputId = `${base}-link`;
  const [markdown, setMarkdown] = useState('');
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    // Rendu serveur : rien avant l'hydratation, le champ de texte en tient lieu.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        listItem: false,
        listKeymap: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: 'https',
          isAllowedUri: (url) => safeHref(url) !== null,
          shouldAutoLink: (url) => !/^http:\/\//iu.test(url),
          HTMLAttributes: { rel: 'nofollow ugc noopener noreferrer', target: null },
        },
      }),
      FlatListItem,
      ListKeymapWithoutTab,
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        id: fieldId,
        class: 'cm-editor-content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
      },
    },
    onUpdate: ({ editor: current }) => setMarkdown(serializeCommunityDoc(current.getJSON())),
  });

  // L'erreur du serveur change après coup : les attributs du champ la suivent.
  useEffect(() => {
    if (editor === null) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          id: fieldId,
          class: 'cm-editor-content',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-labelledby': labelId,
          ...(error === undefined ? {} : { 'aria-invalid': 'true', 'aria-describedby': errorId }),
        },
      },
    });
  }, [editor, error, errorId, fieldId, labelId]);

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current === null
        ? null
        : {
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            bulletList: current.isActive('bulletList'),
            orderedList: current.isActive('orderedList'),
            blockquote: current.isActive('blockquote'),
            link: current.isActive('link'),
          },
  });

  const errorLine =
    error === undefined ? null : (
      <p id={errorId} className="pk-field-error" role="alert">
        {error}
      </p>
    );

  if (editor === null) {
    return (
      <div className="cm-field">
        <label id={labelId} htmlFor={fieldId} className="pk-label">
          {label}
        </label>
        <textarea
          id={fieldId}
          name={name}
          className="cm-input cm-textarea"
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          required={required}
          defaultValue={defaultValue ?? ''}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : errorId}
        />
        {errorLine}
      </div>
    );
  }

  function closeLink(): void {
    setLinkDraft(null);
    setLinkError(null);
    editor?.commands.focus();
  }

  function applyLink(): void {
    if (editor === null || linkDraft === null) return;
    const result = linkFromDraft(linkDraft);
    if ('error' in result) {
      setLinkError(result.error);
      return;
    }
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: result.href,
          marks: [{ type: 'link', attrs: { href: result.href } }],
        })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: result.href }).run();
    }
    setLinkDraft(null);
    setLinkError(null);
  }

  function onLinkKey(event: KeyboardEvent<HTMLInputElement>): void {
    // Entrée dans ce champ ne doit pas envoyer le message entier.
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeLink();
    }
  }

  const tooLong = markdown.length > maxLength;

  return (
    <div className="cm-field">
      {/* Un clic sur le libellé place le curseur dans l'éditeur, comme pour un champ. */}
      <label id={labelId} className="pk-label" onClick={() => editor.commands.focus()}>
        {label}
      </label>
      <div className={`cm-editor${error === undefined && !tooLong ? '' : ' cm-editor-invalid'}`}>
        <div
          role="toolbar"
          aria-label="Mise en forme"
          aria-controls={fieldId}
          className="cm-toolbar"
        >
          {FORMATS.map((format) => (
            <button
              key={format.key}
              type="button"
              className="cm-tool"
              aria-pressed={active?.[format.key] ?? false}
              title={format.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => format.run(editor)}
            >
              <Icon name={format.icon} size={18} />
              <span className="pk-visually-hidden">{format.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="cm-tool"
            aria-pressed={active?.link ?? false}
            aria-expanded={linkDraft !== null}
            title={active?.link === true ? 'Retirer le lien' : 'Lien'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (active?.link === true) {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
              } else if (linkDraft === null) {
                setLinkDraft('');
                // Le champ d'adresse n'existe qu'au rendu suivant.
                requestAnimationFrame(() => linkInput.current?.focus());
              } else {
                closeLink();
              }
            }}
          >
            <Icon name="LinkSimple" size={18} />
            <span className="pk-visually-hidden">
              {active?.link === true ? 'Retirer le lien' : 'Lien'}
            </span>
          </button>
        </div>

        {linkDraft === null ? null : (
          <div className="cm-link-panel">
            <label htmlFor={linkInputId} className="pk-visually-hidden">
              Adresse du lien
            </label>
            <input
              ref={linkInput}
              id={linkInputId}
              type="url"
              inputMode="url"
              className="cm-input"
              placeholder="https://…"
              value={linkDraft}
              onChange={(event) => {
                setLinkDraft(event.target.value);
                setLinkError(null);
              }}
              onKeyDown={onLinkKey}
              aria-invalid={linkError === null ? undefined : true}
              aria-describedby={linkError === null ? undefined : `${linkInputId}-error`}
            />
            <button type="button" className="pk-btn pk-button-secondary" onClick={applyLink}>
              Ajouter le lien
            </button>
            <button type="button" className="cm-tool-text" onClick={closeLink}>
              Annuler
            </button>
            {linkError === null ? null : (
              <p id={`${linkInputId}-error`} className="pk-field-error" role="alert">
                {linkError}
              </p>
            )}
          </div>
        )}

        <EditorContent editor={editor} className="cm-editor-area" />
      </div>
      <input type="hidden" name={name} value={markdown} />
      {markdown.length > maxLength * 0.9 ? (
        <p className={`cm-counter${tooLong ? ' cm-counter-over' : ''}`} aria-live="polite">
          {markdown.length} / {maxLength} caractères
        </p>
      ) : null}
      {errorLine}
    </div>
  );
}
