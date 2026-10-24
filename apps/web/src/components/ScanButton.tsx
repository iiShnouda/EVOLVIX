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
 * 2026-10-06), for people with ai:scan_purchase / ai:scan_cheques: from the camera, or a photo already on the device. What comes back only fills the
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
  /** How long the server has been reading, shown on the button (a slow server takes minutes). */
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Several pages of one invoice can be picked together (owner, 2026-10-19): each is read in turn
  // and its lines added to the same form.
  const [pageOf, setPageOf] = useState<[number, number] | null>(null);
  if (!can(kind === 'purchase' ? 'ai:scan_purchase' : 'ai:scan_cheques')) return null;
  const read = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])].slice(0, 10);
    e.target.value = '';
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const [i, one] of picked.entries()) {
        setPageOf(picked.length > 1 ? [i + 1, picked.length] : null);
        setWaited(0);
        if (!(await readOne(one))) break;
      }
    } finally {
      setBusy(false);
      setPageOf(null);
    }
  };
  /** Read one photo; false when it failed (the error is shown). */
  const readOne = async (picked: File): Promise<boolean> => {
    // The photo kept with the invoice (at most 1600 px), and a smaller one for the model (1280 px):
    // the model's time grows with the photo's size, and the writing still reads at that size.
    const small = await shrinkPhoto(picked).catch(() => picked);
    const photo = new File([small], 'invoice.jpg', { type: small.type || 'image/jpeg' });
    onPhoto?.(photo);
    const forModel = await shrinkPhoto(picked, 1280).catch(() => small);
    let result: T;
    try {
      result = await scanPhoto<T>(
        kind,
        new File([forModel], 'scan.jpg', { type: forModel.type || 'image/jpeg' }),
        setWaited,
      );
    } catch (err) {
      // A gateway in front of the server that gave up waiting answers without our code.
      const gaveUp = err instanceof ApiError && !err.code && [502, 504, 524].includes(err.status);
      setError(gaveUp ? t('error.assistant_timeout') : errorText(t, err));
      return false;
    }
    // Told apart from the reading itself: the photo was read, filling the form failed.
    return Promise.resolve(onResult(result)).then(
      () => true,
      () => {
        setError(t('assistant.fillFailed'));
        return false;
      },
    );
  };
  // One button (owner, 2026-10-19): the phone itself offers the camera or a photo already on it.
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <input
        ref={file}
        aria-label={t(kind === 'purchase' ? 'assistant.scanUpload' : 'assistant.scanCheques')}
        tabIndex={-1}
        type="file"
        multiple
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
          ? `${t('assistant.reading')}${pageOf ? ` ${pageOf[0]}/${pageOf[1]}` : ''} ${Math.floor(waited / 60)}:${String(waited % 60).padStart(2, '0')}`
          : t(kind === 'purchase' ? 'assistant.scanUpload' : 'assistant.scanCheques')}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
