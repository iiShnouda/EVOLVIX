import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** A cheque's kept photo, held in memory only while it is on screen (never cached on the device). */
export function useNotePhoto(noteId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!noteId) {
      setUrl(null);
      return;
    }
    let made: string | null = null;
    let live = true;
    api
      .download(`/notes/${noteId}/photo`)
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
  }, [noteId]);
  return url;
}
