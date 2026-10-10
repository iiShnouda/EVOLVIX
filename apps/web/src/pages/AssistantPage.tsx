import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime, type AssistantTurn } from '@skb/shared';
import { Button, Card, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useAssistantHistory, useAssistantStatus } from '../lib/queries';

/**
 * The company's assistant (owner, 2026-10-06), run offline on the company's own server. People with
 * ai:chat ask it about customers, items, invoices and totals; it answers only from what they may see
 * and never changes anything. The conversation is kept on the server, for this person only.
 */
export function AssistantPage() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const status = useAssistantStatus(true);
  const history = useAssistantHistory();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const turns: AssistantTurn[] = history.data ?? [];
  // A block body: newer browsers return a promise from scrollIntoView, and React would take a
  // returned value for the effect's clean-up ("is not a function" on leaving the page).
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, pending]);
  const ready = !!status.data?.chatReady;

  async function ask() {
    const q = text.trim();
    if (!q || pending) return;
    setPending(q);
    setText('');
    setError(null);
    try {
      await api.post('/assistant/ask', { text: q });
      await qc.invalidateQueries({ queryKey: ['assistant', 'history'] });
    } catch (e) {
      setError(errorText(t, e));
      setText(q);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.assistant')}
        action={
          turns.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              onClick={async () => {
                await api.del('/assistant/history');
                await qc.invalidateQueries({ queryKey: ['assistant', 'history'] });
              }}
            >
              {t('assistant.clear')}
            </Button>
          )
        }
      />
      {status.data && !ready && (
        <Card className="flex items-center gap-2 border-warning/40 bg-warning-soft text-sm text-warning">
          <Icon name="assistant" size={18} />
          {t('assistant.notReady')}
        </Card>
      )}
      <Card
        padded={false}
        className="flex h-[calc(100vh-16rem)] min-h-[420px] flex-col overflow-hidden"
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-2/50 p-4">
          {history.isLoading ? (
            <div className="grid place-items-center py-10 text-muted">
              <Spinner size={22} />
            </div>
          ) : turns.length === 0 && !pending ? (
            <div className="grid h-full place-items-center text-center text-sm text-muted">
              <div>
                <Icon name="assistant" size={32} className="mx-auto mb-2 text-brand" />
                {t('assistant.empty')}
              </div>
            </div>
          ) : (
            <>
              {turns.map((m, i) => (
                <Bubble key={i} turn={m} locale={locale} />
              ))}
              {pending && (
                <>
                  <Bubble
                    turn={{ role: 'user', content: pending, at: new Date().toISOString() }}
                    locale={locale}
                  />
                  <div className="flex justify-end">
                    <span className="inline-flex items-center gap-2 rounded-2xl bg-surface px-3 py-2 text-sm text-muted shadow-sm">
                      <Spinner size={14} />
                      {t('assistant.thinking')}
                    </span>
                  </div>
                </>
              )}
            </>
          )}
          <div ref={end} />
        </div>
        <div className="border-t border-line p-2">
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={text}
              maxLength={2000}
              disabled={!ready}
              placeholder={t('assistant.placeholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
              className="max-h-32 min-h-10 flex-1 resize-none rounded-[var(--radius-app)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-surface-2"
            />
            <Button icon="send" loading={!!pending} disabled={!ready || !text.trim()} onClick={ask}>
              {t('chat.send')}
            </Button>
          </div>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      </Card>
    </div>
  );
}

function Bubble({ turn, locale }: { turn: AssistantTurn; locale: 'ar' | 'en' }) {
  const mine = turn.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          mine ? 'rounded-ss-sm bg-brand text-brand-fg' : 'rounded-se-sm bg-surface'
        }`}
      >
        {!mine && <Icon name="assistant" size={14} className="mb-1 text-brand" />}
        <p className="whitespace-pre-wrap break-words">{turn.content}</p>
        <p className={`mt-1 text-[10px] tnum ${mine ? 'opacity-80' : 'text-faint'}`}>
          {formatDateTime(turn.at, locale)}
        </p>
      </div>
    </div>
  );
}
