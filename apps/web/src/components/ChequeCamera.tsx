import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { Button } from './ui';
import { useT } from '../lib/i18n';

/**
 * Photograph cheques inside the app (owner, 2026-10-02). The camera is opened only while this sheet
 * is open, is never recorded, and is switched off the moment it closes; each photo is taken from the
 * live picture into memory and goes straight to the company server when the cheques are saved —
 * nothing is written to the phone or the computer, and nothing passes through any other service.
 * Several can be taken in a row, one per cheque, or one of all of them together to cut afterwards.
 */
export function CameraSheet({
  onDone,
  onClose,
}: {
  onDone: (photos: Blob[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState(false);
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (!live) {
          s.getTracks().forEach((x) => x.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
      } catch {
        setError(true);
      }
    })();
    return () => {
      live = false;
      stream.current?.getTracks().forEach((x) => x.stop());
      stream.current = null;
    };
  }, []);

  // The thumbnails live only while the sheet is open.
  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots]);

  function take() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob(
      (b) => b && setShots((cur) => [...cur, { blob: b, url: URL.createObjectURL(b) }]),
      'image/jpeg',
      0.9,
    );
    navigator.vibrate?.(40);
  }

  function finish() {
    stream.current?.getTracks().forEach((x) => x.stop());
    onDone(shots.map((s) => s.blob));
  }

  return (
    <Sheet title={t('cheque.camera')} onClose={onClose} closeLabel={t('common.close')} wide>
      <div className="space-y-3">
        {error ? (
          <p className="rounded-[var(--radius-app)] bg-destructive-soft p-3 text-sm text-destructive">
            {t('scan.noCamera')}
          </p>
        ) : (
          <div className="relative">
            <video
              ref={video}
              className="aspect-[16/9] w-full rounded-[var(--radius-app)] bg-black object-contain"
              muted
              playsInline
            />
            <button
              type="button"
              onClick={take}
              aria-label={t('cheque.take')}
              className="absolute bottom-3 start-1/2 grid h-16 w-16 -translate-x-1/2 place-items-center rounded-full border-4 border-white bg-brand text-white shadow-lg rtl:translate-x-1/2"
            >
              <Icon name="camera" size={24} />
            </button>
          </div>
        )}
        <p className="text-xs text-muted">{t('cheque.cameraHint')}</p>
        {shots.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {shots.map((s, i) => (
              <li key={s.url} className="relative">
                <img
                  src={s.url}
                  alt=""
                  className="h-20 w-32 rounded-md border border-line object-cover"
                />
                <span className="absolute start-1 top-1 rounded bg-black/60 px-1 text-xs text-white tnum">
                  {i + 1}
                </span>
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => setShots((cur) => cur.filter((x) => x !== s))}
                  className="absolute end-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/60 text-white"
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button icon="check" disabled={shots.length === 0} onClick={finish}>
            {t('cheque.usePhotos')} ({shots.length})
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One photo of several cheques: draw a box around each cheque in turn and it is cut out and put on
 * that cheque (owner, 2026-10-02). Done on this device, in memory.
 */
export function CropSheet({
  photo,
  labels,
  onCut,
  onClose,
}: {
  photo: Blob;
  /** The cheques still without a photo, in order: the next box goes to the first. */
  labels: string[];
  onCut: (piece: Blob) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [url] = useState(() => URL.createObjectURL(photo));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [done, setDone] = useState<Box[]>([]);
  const start = useRef<{ x: number; y: number } | null>(null);

  const point = (e: ReactPointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  async function cut() {
    if (!box || !img.current || box.w < 0.02 || box.h < 0.02) return;
    const bitmap = await createImageBitmap(photo);
    const sx = Math.round(box.x * bitmap.width);
    const sy = Math.round(box.y * bitmap.height);
    const sw = Math.round(box.w * bitmap.width);
    const sh = Math.round(box.h * bitmap.height);
    const scale = Math.min(1, 1800 / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext('2d')?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const piece = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
    if (!piece) return;
    onCut(piece);
    setDone((cur) => [...cur, box]);
    setBox(null);
  }

  const next = labels[0];
  return (
    <Sheet
      title={t('cheque.cropTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      wide="full"
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {next ? (
            <>
              {t('cheque.cropHint')} <b className="text-fg">{next}</b>
            </>
          ) : (
            t('cheque.cropAllDone')
          )}
        </p>
        <div className="relative inline-block max-w-full touch-none select-none">
          <img
            ref={img}
            src={url}
            alt=""
            draggable={false}
            className="max-h-[65vh] max-w-full rounded-[var(--radius-app)] border border-line"
            onPointerDown={(e) => {
              if (!next) return;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              start.current = point(e);
              setBox({ ...start.current, w: 0, h: 0 });
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              const p = point(e);
              const s = start.current;
              setBox({
                x: Math.min(s.x, p.x),
                y: Math.min(s.y, p.y),
                w: Math.abs(p.x - s.x),
                h: Math.abs(p.y - s.y),
              });
            }}
            onPointerUp={() => (start.current = null)}
          />
          {[...done, ...(box ? [box] : [])].map((b, i) => (
            <span
              key={i}
              className={`pointer-events-none absolute border-2 ${i < done.length ? 'border-positive bg-positive/15' : 'border-brand bg-brand/10'}`}
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
              }}
            >
              {i < done.length && (
                <span className="absolute start-1 top-1 rounded bg-positive px-1 text-xs text-white tnum">
                  {i + 1}
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button icon="check" disabled={!next || !box || box.w < 0.02} onClick={() => void cut()}>
            {next ? `${t('cheque.cutFor')} ${next}` : t('cheque.cutFor')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
