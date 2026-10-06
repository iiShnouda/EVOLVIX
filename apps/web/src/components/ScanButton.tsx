import { useRef, useState } from 'react';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { scanPhoto } from '../lib/queries';

/**
 * Read a supplier invoice or cheques from a photo with the company's offline assistant (owner,
 * 2026-10-06), for people with ai:scan. The camera opens on a phone. What comes back only fills the
 * form; the person checks it and saves as usual. The photo is not kept anywhere.
 */
export function ScanButton<T>({
  kind,
  onResult,
  disabled,
}: {
  kind: 'purchase' | 'cheques';
  onResult: (result: T) => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useT();
  const can = useCan();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can('ai:scan')) return null;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            await onResult(await scanPhoto<T>(kind, file));
          } catch (err) {
            setError(errorText(t, err));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        variant="secondary"
        icon="assistant"
        loading={busy}
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy
          ? t('assistant.reading')
          : t(kind === 'purchase' ? 'assistant.scanInvoice' : 'assistant.scanCheques')}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
