import { en, type Translate, type TranslationKey } from '@skb/shared';
import { ApiError } from './api';

/**
 * A failed request's message in the screen language: the `error.<code>` text when the dictionary
 * has one for the server's code, else the server's own message.
 */
export function errorText(t: Translate, error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.code) {
    const key = `error.${error.code}`;
    if (key in en) return t(key as TranslationKey);
  }
  return error instanceof Error ? error.message : String(error);
}
