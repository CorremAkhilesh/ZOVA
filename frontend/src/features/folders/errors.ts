import { FOLDERS_MAX } from '@zuvo/protocol';
import type { TFunction } from 'i18next';
import { authErrorMessage, errorCode } from '@/features/auth/errors';

/** A folder request's error, in the current language. */
export function folderErrorMessage(error: unknown, t: TFunction): string {
  if (errorCode(error) === 'FOLDER_LIMIT_REACHED') return t('folders.limit', { max: FOLDERS_MAX });
  return authErrorMessage(error, t);
}
