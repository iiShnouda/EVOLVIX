import { useEffect, useRef, useState } from 'react';
import type { Party } from '@skb/shared';
import { Button, Spinner } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useQueryClient } from '@tanstack/react-query';

export type IdSide = 'front' | 'back';

/**
 * A photo made smaller before it is sent (at most 1600 px, JPEG): ID cards stay readable and small.
 * Nothing is kept on the device.
 */
export async function shrinkPhoto(file: Blob, longest = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('photo'))), 'image/jpeg', 0.85),
  );
}

/** The kept photo of one side, held in memory only while it is on screen. */
function useIdPhoto(partyId: string | null, side: IdSide, has: boolean, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!partyId || !has) {
      setUrl(null);
      return;
    }
    let made: string | null = null;
    let live = true;
    api
      .download(`/parties/${partyId}/id-card/${side}`)
      .then((f) => {
        if (!live) return;
        made = URL.createObjectURL(
          new Blob([f.bytes as BlobPart], { type: f.type || 'image/jpeg' }),
        );
        setUrl(made);
      })
      .catch(() => live && setUrl(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [partyId, side, has, version]);
  return url;
}

/** One side of the ID card: its photo (kept or about to be sent), Add / Remove. */
function Slot({
  party,
  side,
  pending,
  onPending,
}: {
  party: Party | null;
  side: IdSide;
  pending: Blob | null;
  onPending: (b: Blob | null) => void;
}) {
  const { t } = useT();
  const qc = useQueryClient();
  const has = !!(side === 'front' ? party?.hasIdFront : party?.hasIdBack);
  const [version, setVersion] = useState(0);
  const kept = useIdPhoto(party?.id ?? null, side, has, version);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!pending) return setPreview(null);
    const u = URL.createObjectURL(pending);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [pending]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const photo = await shrinkPhoto(file);
      // A party already saved keeps it at once; a new one sends it after it is saved.
      if (!party) return onPending(photo);
      setBusy(true);
      await api.upload(`/parties/${party.id}/id-card/${side}`, photo);
      await qc.invalidateQueries({ queryKey: ['parties'] });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorText(t, e) ?? t('parties.photoTooBig'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function remove() {
    if (!party) return onPending(null);
    setBusy(true);
    try {
      await api.del(`/parties/${party.id}/id-card/${side}`);
      await qc.invalidateQueries({ queryKey: ['parties'] });
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? kept;
  return (
    <div className="space-y-1.5">
      <span className="block text-xs text-muted">
        {t(side === 'front' ? 'parties.idFront' : 'parties.idBack')}
      </span>
      <div className="grid aspect-[1.6] place-items-center overflow-hidden rounded-[var(--radius-app)] border border-dashed border-line bg-surface-2">
        {busy ? (
          <Spinner size={18} />
        ) : shown ? (
          <img src={shown} alt="" className="h-full w-full object-contain" />
        ) : (
          <Icon name="user" size={22} className="text-faint" />
        )}
      </div>
      <div className="flex gap-1">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon="plus"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {t('parties.idPick')}
        </Button>
        {(shown || has) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void remove()}
          >
            {t('parties.idRemove')}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Front and back of the ID card in the party form. */
export function IdCardFields({
  party,
  pending,
  onPending,
}: {
  party: Party | null;
  pending: Record<IdSide, Blob | null>;
  onPending: (side: IdSide, b: Blob | null) => void;
}) {
  const { t } = useT();
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 block text-xs text-muted">{t('parties.idCard')}</legend>
      <div className="grid grid-cols-2 gap-3">
        {(['front', 'back'] as const).map((side) => (
          <Slot
            key={side}
            party={party}
            side={side}
            pending={pending[side]}
            onPending={(b) => onPending(side, b)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** The kept photos, to look at (read only). */
export function IdCardView({ party }: { party: Party }) {
  const { t } = useT();
  const front = useIdPhoto(party.id, 'front', !!party.hasIdFront, 0);
  const back = useIdPhoto(party.id, 'back', !!party.hasIdBack, 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ['parties.idFront', front, party.hasIdFront],
          ['parties.idBack', back, party.hasIdBack],
        ] as const
      ).map(([label, url, has]) =>
        has ? (
          <figure key={label} className="space-y-1">
            <figcaption className="text-xs text-muted">{t(label)}</figcaption>
            <div className="grid aspect-[1.6] place-items-center overflow-hidden rounded-[var(--radius-app)] border border-line bg-surface-2">
              {url ? (
                <img src={url} alt={t(label)} className="h-full w-full object-contain" />
              ) : (
                <Spinner size={18} />
              )}
            </div>
          </figure>
        ) : null,
      )}
    </div>
  );
}
