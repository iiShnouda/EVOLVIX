import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { useT } from '../lib/i18n';

/**
 * Scan barcodes with the phone's (or laptop's) camera. Keeps scanning so a whole order can be
 * scanned in one go; the same code is taken again only after a short pause. Each code goes to
 * `onScan`, which says what it found (shown under the picture). Needs HTTPS and camera permission.
 */
export function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    const seen = new Map<string, number>();
    void (async () => {
      try {
        // Loaded only when the camera is opened.
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || !video.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          video.current,
          (result) => {
            if (!result) return;
            const code = result.getText();
            const now = Date.now();
            if (now - (seen.get(code) ?? 0) < 1500) return;
            seen.set(code, now);
            navigator.vibrate?.(60);
            void handler
              .current(code)
              .then((found) => setLast(found ?? `${code} — ${t('scan.notFound')}`));
          },
        );
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
      } catch {
        setError(t('scan.noCamera'));
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [t]);

  return (
    <Sheet title={t('scan.title')} onClose={onClose} closeLabel={t('common.close')}>
      <div className="space-y-3">
        {error ? (
          <p className="rounded-[var(--radius-app)] bg-destructive-soft p-3 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <video
            ref={video}
            className="aspect-[4/3] w-full rounded-[var(--radius-app)] bg-black object-cover"
            muted
            playsInline
          />
        )}
        <p className="text-sm text-muted">{last ?? t('scan.hint')}</p>
        <div className="flex justify-end">
          <Button icon="check" onClick={onClose}>
            {t('scan.done')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
