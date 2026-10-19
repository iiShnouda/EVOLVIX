import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Spinner } from './ui';
import { Icon } from './Icon';
import { shrinkPhoto } from './IdCards';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';

/** The item's photo, fetched with the sign-in and held only while on screen (never cached). */
function useProductPhoto(productId: string, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let made: string | null = null;
    let live = true;
    setLoading(true);
    api
      .download(`/products/${productId}/image`)
      .then((f) => {
        if (!live) return;
        made = URL.createObjectURL(
          new Blob([f.bytes as BlobPart], { type: f.type || 'image/jpeg' }),
        );
        setUrl(made);
      })
      .catch(() => live && setUrl(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [productId, version]);
  return { url, loading };
}

/**
 * The item's photo in the item editor (owner, 2026-10-12): a preview, with upload or camera and
 * remove. Only JPEG/PNG/WebP up to 3 MB; the server checks the file's own bytes, so a script
 * renamed to a photo is refused. Needs <c>products:edit</c> to change.
 */
export function ProductImageCard({ productId, canEdit }: { productId: string; canEdit: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [version, setVersion] = useState(0);
  const { url, loading } = useProductPhoto(productId, version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const photo = await shrinkPhoto(file);
      await api.upload(`/products/${productId}/image`, photo);
      setVersion((v) => v + 1);
      await qc.invalidateQueries({ queryKey: ['catalog', 'product', productId] });
    } catch (e) {
      setError(errorText(t, e) ?? t('item.photoTooBig'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/products/${productId}/image`);
      setVersion((v) => v + 1);
      await qc.invalidateQueries({ queryKey: ['catalog', 'product', productId] });
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  const has = !!url;
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t('item.photo')}
      </h2>
      <div className="grid aspect-square place-items-center overflow-hidden rounded-[var(--radius-app)] border border-dashed border-line bg-surface-2">
        {busy || loading ? (
          <Spinner size={20} />
        ) : url ? (
          <img src={url} alt="" className="h-full w-full object-contain" />
        ) : (
          <Icon name="camera" size={28} className="text-faint" />
        )}
      </div>
      {canEdit ? (
        <div className="flex gap-1.5">
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
            icon="camera"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {has ? t('item.photoChange') : t('item.photoPick')}
          </Button>
          {has && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t('item.photoRemove')}
            </Button>
          )}
        </div>
      ) : (
        !has && <p className="text-xs text-muted">{t('item.photoHint')}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Card>
  );
}
