import { FOLDER_NAME_MAX } from '@zuvo/protocol';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { FolderEditorRequest } from '../store';
import { useFolderForm } from '../use-folder-form';
import { ChatPicker } from './ChatPicker';
import { EmojiField, RuleFields } from './FolderFields';

function DeleteConfirm(props: { name: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-3 rounded-xl border border-danger/40 p-3">
      <legend className="sr-only">{t('folders.deleteTitle', { name: props.name })}</legend>
      <p className="text-sm font-medium">{t('folders.deleteTitle', { name: props.name })}</p>
      <p className="text-xs text-text-muted">{t('folders.deleteHint')}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" variant="danger" onClick={props.onConfirm}>
          {t('folders.delete')}
        </Button>
      </div>
    </fieldset>
  );
}

function NameField(props: { value: string; invalid: boolean; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const nameId = useId();
  const errorId = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={nameId} className="text-sm font-medium">
        {t('folders.name')}
      </label>
      <Input
        id={nameId}
        value={props.value}
        maxLength={FOLDER_NAME_MAX}
        placeholder={t('folders.namePlaceholder')}
        aria-invalid={props.invalid}
        aria-describedby={props.invalid ? errorId : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.invalid ? (
        <p id={errorId} className="text-xs text-danger">
          {t('folders.nameRequired')}
        </p>
      ) : null}
    </div>
  );
}

/** Create or edit one of my folders: its name, emoji, rules and picked chats. */
export default function FolderEditor({ request }: { request: FolderEditorRequest }) {
  const { t } = useTranslation();
  const form = useFolderForm(request);
  const { editing, fields } = form;
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : form.close())}>
      <DialogContent
        title={t(editing ? 'folders.editTitle' : 'folders.newTitle')}
        className="max-w-lg"
      >
        <form onSubmit={form.submit} noValidate className="flex min-h-0 flex-col gap-4">
          <div className="-mx-1 min-h-0 space-y-5 overflow-y-auto px-1">
            <NameField value={fields.name} invalid={form.nameError} onChange={form.setName} />
            <EmojiField value={fields.emoji} onChange={form.setEmoji} />
            <RuleFields value={fields.rules} onChange={form.setRules} />
            <ChatPicker picked={fields.chatIds} onChange={form.setChatIds} />
          </div>
          {form.serverError ? (
            <p role="alert" className="text-sm text-danger">
              {form.serverError}
            </p>
          ) : null}
          {editing && confirmDelete ? (
            <DeleteConfirm
              name={editing.name}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={form.deleteFolder}
            />
          ) : null}
          <div className="flex items-center gap-2">
            {editing && !confirmDelete ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                {t('folders.delete')}
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button type="button" variant="ghost" onClick={form.close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.creating}>
              {t(editing ? 'folders.save' : 'folders.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
