import { en, type Translate, type TranslationKey } from '@skb/shared';
import { ApiError } from './api';

/**
 * A failed request's message in the screen language, short (owner, 2026-10-02: no examples, no
 * extra details): the `error.<code>` text for the server's code, else one general line. The
 * server's own English message (which may carry figures) is never shown.
 */
export function errorText(t: Translate, error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    // Failed on the server: its request number too, so the owner can find it in the server's log.
    if (error.status >= 500 && error.requestId)
      return `${t('error.server_error')} ${t('error.requestId').replace('{id}', error.requestId)}`;
    const key = `error.${error.code}`;
    if (error.code && key in en) return t(key as TranslationKey);
    if (error.status === 403) return t('error.forbidden');
    if (error.status === 429) return t('error.rate_limited');
    if (error.status === 404) return t('error.not_found');
    return t('error.generic');
  }
  return t('error.generic');
}
