import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from './ui';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { errorText } from '../lib/errors';
import { scanPhoto } from '../lib/queries';
import { ApiError } from '../lib/api';
import { shrinkPhoto } from './IdCards';

/**
 * Read a supplier invoice or cheques from a photo with the company's offline assistant (owner,
 * 2026-10-06), for people with ai:scan: from the camera, or a photo already on the device. What comes back only fills the
 * form; the person checks it and saves as usual. The photo is not kept anywhere.
 */
export function ScanButton<T>({
  kind,
  onResult,
  onPhoto,
  disabled,
}: {
  kind: 'purchase' | 'cheques';
  onResult: (result: T) => void | Promise<void>;
  /** The photo taken or picked, kept by the page (owner, 2026-10-19: shown with the invoice). */
  onPhoto?: (file: File) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const can = useCan();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can('ai:scan')) return null;
  const read = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      // Made smaller first (at most 1600 px): a full phone photo takes the server's model minutes.
      const small = await shrinkPhoto(picked).catch(() => picked);
      const photo = new File([small], 'invoice.jpg', { type: small.type || 'image/jpeg' });
      onPhoto?.(photo);
      let result: T;
      try {
        result = await scanPhoto<T>(kind, photo);
      } catch (err) {
        // A gateway in front of the server that gave up waiting answers without our code.
        const gaveUp = err instanceof ApiError && !err.code && [502, 504, 524].includes(err.status);
        setError(gaveUp ? t('error.assistant_timeout') : errorText(t, err));
        return;
      }
      // Told apart from the reading itself: the photo was read, filling the form failed.
      await Promise.resolve(onResult(result)).catch(() => setError(t('assistant.fillFailed')));
    } finally {
      setBusy(false);
    }
  };
  // One button (owner, 2026-10-19): the phone itself offers the camera or a photo already on it.
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={read}
      />
      <Button
        variant="secondary"
        icon="camera"
        loading={busy}
        disabled={disabled || busy}
        onClick={() => file.current?.click()}
      >
        {busy
          ? t('assistant.reading')
          : t(kind === 'purchase' ? 'assistant.scanUpload' : 'assistant.scanCheques')}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
