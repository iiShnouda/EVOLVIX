import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  formatDateTime,
  type AssistantAnswer,
  type AssistantConversation,
  type AssistantTurn,
} from '@skb/shared';
import { Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../lib/i18n';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useDeviceInfo } from '../lib/device';
import { useAssistantConversations, useAssistantStatus, useAssistantTurns } from '../lib/queries';
import { canTalk, openVoiceInput, Speaker, type VoiceInput } from '../lib/voice';
import { VoiceCall } from '../components/VoiceCall';

/**
 * The company's assistant (owner, 2026-10-06), run offline on the company's own server. People with
 * ai:chat ask it about customers, items, invoices and totals; it answers only from what they may see
 * and never changes anything. Each person keeps several conversations on the server, theirs alone,
 * and deletes any or all of the old ones (owner, 2026-10-10). Answers come in the app's language, and
 * one can talk with it by voice (owner, 2026-10-11): see VoiceCall. Any answer can be read aloud by
 * the server's own voice.
 */
export function AssistantPage() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const phone = useDeviceInfo().deviceClass === 'phone';
  const status = useAssistantStatus(true);
  const list = useAssistantConversations();
  const [params, setParams] = useSearchParams();
  const chosen = params.get('c');
  const [fresh, setFresh] = useState(false);
  const conversations = list.data ?? [];
  const current = conversations.find((c) => c.id === chosen) ?? null;
  const ready = !!status.data?.chatReady;
  const voices = status.data?.voiceLanguages ?? [];
  const serverVoice = voices.includes(locale);
  const [call, setCall] = useState<{ speaker: Speaker; input: Promise<VoiceInput> } | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  // Made in the tap itself: phones only let sound and the microphone start from one.
  function startCall() {
    setCallError(null);
    if (!canTalk()) {
      setCallError(t('assistant.micUnavailable'));
      return;
    }
    const speaker = new Speaker();
    speaker.unlock();
    const input = openVoiceInput();
    input.catch(() => undefined);
    setCall({ speaker, input });
  }

  const open = (id: string | null, startNew = false) => {
    const next = new URLSearchParams(params);
    if (id) next.set('c', id);
    else next.delete('c');
    setParams(next, { replace: true });
    setFresh(startNew);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['assistant'] });

  async function remove(id: string) {
    if (!window.confirm(t('assistant.deleteAsk'))) return;
    await api.del(`/assistant/conversations/${id}`);
    if (chosen === id) open(null);
    await refresh();
  }

  async function removeOld(days: number | null) {
    if (!window.confirm(t(days ? 'assistant.deleteOldAsk' : 'assistant.deleteAllAsk'))) return;
    await api.del(`/assistant/conversations${days ? `?olderThanDays=${days}` : ''}`);
    if (!days) open(null);
    await refresh();
  }

  const listPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <Button icon="plus" className="w-full" onClick={() => open(null, true)}>
          {t('assistant.new')}
        </Button>
      </div>
      {list.isLoading ? (
        <div className="grid place-items-center py-10 text-muted">
          <Spinner size={22} />
        </div>
      ) : conversations.length === 0 ? (
        <EmptyState title={t('assistant.noConversations')} icon="assistant" />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--c-line)] overflow-y-auto border-t border-line">
          {conversations.map((c: AssistantConversation) => (
            <li key={c.id} className="group flex items-stretch">
              <button
                type="button"
                onClick={() => open(c.id)}
                className={`min-w-0 flex-1 px-3 py-2.5 text-start hover:bg-surface-2 ${
                  c.id === chosen ? 'bg-brand-soft/60' : ''
                }`}
              >
                <span dir="auto" className="block truncate text-start text-sm font-semibold">
                  {c.title}
                </span>
                <span className="block text-[11px] text-faint tnum">
                  {formatDateTime(c.updatedAt, locale)}
                </span>
              </button>
              <button
                type="button"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                onClick={() => void remove(c.id)}
                className="grid w-10 shrink-0 place-items-center text-faint hover:bg-destructive-soft hover:text-destructive"
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {conversations.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-line p-2">
          <Button size="sm" variant="ghost" onClick={() => void removeOld(30)}>
            {t('assistant.deleteOld')}
          </Button>
          <Button size="sm" variant="dangerGhost" onClick={() => void removeOld(null)}>
            {t('assistant.deleteAll')}
          </Button>
        </div>
      )}
    </div>
  );

  const showThread = !phone || !!chosen || fresh;
  const threadPane = (
    <Thread
      key={chosen ?? 'new'}
      conversation={current}
      conversationId={chosen}
      ready={ready}
      canTalk={!!status.data?.speechReady}
      voices={voices}
      talkError={callError}
      onTalk={startCall}
      onBack={phone ? () => open(null) : undefined}
      onStarted={(id) => open(id)}
    />
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.assistant')} />
      {status.data && !ready && (
        <Card className="flex items-center gap-2 border-warning/40 bg-warning-soft text-sm text-warning">
          <Icon name="assistant" size={18} />
          {t('assistant.notReady')}
        </Card>
      )}
      <Card
        padded={false}
        className="grid h-[calc(100vh-16rem)] min-h-[440px] grid-cols-1 overflow-hidden md:grid-cols-[280px_minmax(0,1fr)]"
      >
        {phone ? (
          showThread ? (
            threadPane
          ) : (
            listPane
          )
        ) : (
          <>
            <div className="min-h-0 border-e border-line">{listPane}</div>
            <div className="min-h-0">{threadPane}</div>
          </>
        )}
      </Card>
      {call && (
        <VoiceCall
          conversationId={chosen}
          serverVoice={serverVoice}
          speaker={call.speaker}
          input={call.input}
          onConversation={(id) => open(id)}
          onClose={() => setCall(null)}
        />
      )}
    </div>
  );
}

/** One conversation (or a new one): its questions and answers, and the box to ask in. */
function Thread({
  conversation,
  conversationId,
  ready,
  canTalk,
  voices,
  talkError,
  onTalk,
  onBack,
  onStarted,
}: {
  conversation: AssistantConversation | null;
  conversationId: string | null;
  ready: boolean;
  /** The server can hear: a voice conversation can start. */
  canTalk: boolean;
  /** The languages the server's voice speaks. */
  voices: string[];
  talkError: string | null;
  onTalk: () => void;
  onBack?: () => void;
  onStarted: (id: string) => void;
}) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const history = useAssistantTurns(conversationId);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const turns: AssistantTurn[] = conversationId ? (history.data ?? []) : [];
  // A block body: newer browsers return a promise from scrollIntoView, and React would take a
  // returned value for the effect's clean-up ("is not a function" on leaving the page).
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, pending]);

  async function ask() {
    const q = text.trim();
    if (!q || pending) return;
    setPending(q);
    setText('');
    setError(null);
    try {
      const res = await api.post<AssistantAnswer>('/assistant/ask', {
        text: q,
        conversationId: conversationId ?? undefined,
        language: locale,
      });
      await qc.invalidateQueries({ queryKey: ['assistant'] });
      if (!conversationId) onStarted(res.conversationId);
    } catch (e) {
      setError(errorText(t, e));
      setText(q);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 items-center gap-2 border-b border-line px-3 py-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2"
          >
            <Icon name="chevronRight" size={18} className="rotate-180" />
          </button>
        )}
        <h2 dir="auto" className="min-w-0 flex-1 truncate text-start text-sm font-semibold">
          {conversation?.title ?? t('assistant.new')}
        </h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-2/50 p-4">
        {conversationId && history.isLoading ? (
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
              <Bubble key={i} turn={m} locale={locale} voices={voices} />
            ))}
            {pending && (
              <>
                <Bubble
                  turn={{ role: 'user', content: pending, at: new Date().toISOString() }}
                  locale={locale}
                  voices={voices}
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
          {canTalk && (
            <button
              type="button"
              disabled={!ready || !!pending}
              onClick={onTalk}
              aria-label={t('assistant.talk')}
              title={t('assistant.talk')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-app)] border border-line bg-surface text-brand transition-colors hover:bg-brand-soft disabled:opacity-50"
            >
              <Icon name="waves" size={18} />
            </button>
          )}
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
            className="max-h-32 min-h-10 min-w-0 flex-1 resize-none rounded-[var(--radius-app)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-surface-2"
          />
          <Button icon="send" loading={!!pending} disabled={!ready || !text.trim()} onClick={ask}>
            {t('chat.send')}
          </Button>
        </div>
        {(error || talkError) && (
          <p className="mt-1 text-xs text-destructive">{error ?? talkError}</p>
        )}
      </div>
    </div>
  );
}

function Bubble({
  turn,
  locale,
  voices,
}: {
  turn: AssistantTurn;
  locale: 'ar' | 'en';
  voices: string[];
}) {
  const mine = turn.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          mine ? 'rounded-ss-sm bg-brand text-brand-fg' : 'rounded-se-sm bg-surface'
        }`}
      >
        {!mine && (
          <div className="mb-1 flex items-center justify-between gap-3">
            <Icon name="assistant" size={14} className="text-brand" />
            <SpeakButton text={turn.content} voices={voices} />
          </div>
        )}
        <p dir="auto" className="whitespace-pre-wrap break-words text-start">
          {turn.content}
        </p>
        <p className={`mt-1 text-[10px] tnum ${mine ? 'opacity-80' : 'text-faint'}`}>
          {formatDateTime(turn.at, locale)}
        </p>
      </div>
    </div>
  );
}

/**
 * Read an answer aloud: the server's own voice (the same on every device, Arabic too), else the
 * device's. Its language is the answer's own.
 */
function SpeakButton({ text, voices }: { text: string; voices: string[] }) {
  const { t } = useT();
  const [speaking, setSpeaking] = useState(false);
  const speaker = useRef<Speaker | null>(null);
  useEffect(() => {
    return () => speaker.current?.stop();
  }, []);

  async function toggle() {
    if (speaking) {
      speaker.current?.stop();
      setSpeaking(false);
      return;
    }
    const s = (speaker.current ??= new Speaker());
    setSpeaking(true);
    const arabic =
      (text.match(/[\u0621-\u064A]/g)?.length ?? 0) >= (text.match(/[A-Za-z]/g)?.length ?? 0);
    const language = arabic ? 'ar' : 'en';
    try {
      await s.say(text, language, voices.includes(language));
    } finally {
      setSpeaking(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={t(speaking ? 'assistant.stopSpeaking' : 'assistant.speak')}
      title={t(speaking ? 'assistant.stopSpeaking' : 'assistant.speak')}
      className={`grid h-6 w-6 place-items-center rounded-md hover:bg-surface-2 ${speaking ? 'text-brand' : 'text-faint'}`}
    >
      <Icon name={speaking ? 'stop' : 'speaker'} size={14} />
    </button>
  );
}
