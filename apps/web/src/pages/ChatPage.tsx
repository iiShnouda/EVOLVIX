import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDateTime, type ChatConversation, type ChatPerson } from '@skb/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { useAuth } from '../stores/auth';
import { errorText } from '../lib/errors';
import { onChat } from '../lib/presence';
import { useDeviceInfo } from '../lib/device';
import {
  useChatActions,
  useChatMessages,
  useChatPeople,
  useChatStatus,
  useConversations,
} from '../lib/queries';

/** What a conversation is called: a group's name, else the other person (or both, for a supervisor). */
function titleOf(c: ChatConversation, me: string): string {
  if (c.kind === 'GROUP') return c.title ?? '';
  const others = c.members.filter((m) => m.id !== me);
  return (c.mine ? others : c.members).map((m) => m.name).join(' ↔ ');
}

/**
 * The staff chat (owner, 2026-10-06): one-to-one and group conversations between colleagues. A
 * supervisor (chat:monitor) can read every conversation; with chat:manage they make groups and stop
 * or allow people writing. Messages are read from the server as they arrive; none are kept here.
 */
export function ChatPage() {
  const { t, locale } = useT();
  const can = useCan();
  const me = useAuth((s) => s.user?.id ?? '');
  const { deviceClass } = useDeviceInfo();
  const phone = deviceClass === 'phone';
  const canUse = can('chat:use');
  const canMonitor = can('chat:monitor');
  const canManage = can('chat:manage');
  const [params, setParams] = useSearchParams();
  const all = canMonitor && params.get('all') === '1';
  const chosen = params.get('c');
  const status = useChatStatus(true);
  const list = useConversations(all || !canUse);
  const actions = useChatActions();
  const [picking, setPicking] = useState<'direct' | 'group' | 'mutes' | null>(null);
  const [editing, setEditing] = useState<ChatConversation | null>(null);

  // New messages arrive over the live connection.
  useEffect(
    () =>
      onChat(() => {
        void actions.refresh();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('c', id);
    else next.delete('c');
    setParams(next, { replace: true });
  };
  const conversations = list.data ?? [];
  const current = conversations.find((c) => c.id === chosen) ?? null;

  const listPane = (
    <div className="flex min-h-0 flex-col">
      {canMonitor && canUse && (
        <div className="m-2 flex rounded-[var(--radius-app)] bg-surface-2 p-1 text-sm">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => {
                const next = new URLSearchParams();
                if (v) next.set('all', '1');
                setParams(next, { replace: true });
              }}
              className={`h-8 flex-1 rounded-lg ${all === v ? 'bg-surface font-semibold text-brand shadow-sm' : 'text-muted'}`}
            >
              {t(v ? 'chat.all' : 'chat.mine')}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 px-2 pb-2">
        {canUse && (
          <Button size="sm" icon="plus" onClick={() => setPicking('direct')}>
            {t('chat.new')}
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="secondary" icon="parties" onClick={() => setPicking('group')}>
            {t('chat.newGroup')}
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="ghost" onClick={() => setPicking('mutes')}>
            {t('chat.writing')}
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <div className="grid place-items-center py-10 text-muted">
          <Spinner size={22} />
        </div>
      ) : conversations.length === 0 ? (
        <EmptyState title={t('chat.empty')} icon="chat" />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--c-line)] overflow-y-auto border-t border-line">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => open(c.id)}
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-start hover:bg-surface-2 ${
                  c.id === chosen ? 'bg-brand-soft/60' : ''
                }`}
              >
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-brand">
                  <Icon name={c.kind === 'GROUP' ? 'parties' : 'chat'} size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{titleOf(c, me)}</span>
                    <span className="shrink-0 text-[11px] text-faint tnum" title={formatDateTime(c.lastAt, locale)}>
                      {listTime(c.lastAt, locale)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted">{c.lastText ?? ''}</span>
                    {c.unread > 0 && <Badge tone="brand">{c.unread}</Badge>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const threadPane = current ? (
    <Thread
      conversation={current}
      me={me}
      muted={!!status.data?.muted}
      onBack={phone ? () => open(null) : undefined}
      onEdit={canManage && current.kind === 'GROUP' ? () => setEditing(current) : undefined}
    />
  ) : (
    <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">
      {t('chat.choose')}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.chat')} />
      <Card
        padded={false}
        className="grid h-[calc(100vh-15rem)] min-h-[420px] grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]"
      >
        {phone ? (
          current ? (
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
      {(picking === 'direct' || picking === 'group' || editing) && (
        <PeopleSheet
          mode={editing ? 'edit' : picking === 'group' ? 'group' : 'direct'}
          editing={editing}
          me={me}
          onClose={() => {
            setPicking(null);
            setEditing(null);
          }}
          onOpened={(id) => {
            setPicking(null);
            setEditing(null);
            void actions.refresh();
            open(id);
          }}
        />
      )}
      {picking === 'mutes' && <MutesSheet me={me} onClose={() => setPicking(null)} />}
    </div>
  );
}

/** One conversation: its messages and, for its members, the box to write in. */
function Thread({
  conversation,
  me,
  muted,
  onBack,
  onEdit,
}: {
  conversation: ChatConversation;
  me: string;
  muted: boolean;
  onBack?: () => void;
  onEdit?: () => void;
}) {
  const { t, locale } = useT();
  const can = useCan();
  const messages = useChatMessages(conversation.id);
  const actions = useChatActions();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => messages.data ?? [], [messages.data]);
  // A block body: newer browsers return a promise from scrollIntoView, and React would take a
  // returned value for the effect's clean-up ("is not a function" on leaving the page).
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [rows.length]);
  const canWrite = conversation.mine && can('chat:use') && !muted;

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await actions.send(conversation.id, body);
      setText('');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t('common.back')}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2"
          >
            <Icon name="chevronRight" size={18} className="rotate-180" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{titleOf(conversation, me)}</p>
          {conversation.kind === 'GROUP' && (
            <p className="truncate text-xs text-muted">
              {conversation.members.map((m) => m.name).join('، ')}
            </p>
          )}
        </div>
        {onEdit && (
          <Button size="sm" variant="ghost" icon="edit" onClick={onEdit}>
            {t('common.edit')}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-2/50 px-3 py-3">
        {messages.isLoading ? (
          <div className="grid place-items-center py-10 text-muted">
            <Spinner size={22} />
          </div>
        ) : (
          rows.map((m) => {
            const mine = m.senderId === me;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    mine ? 'rounded-ss-sm bg-brand text-brand-fg' : 'rounded-se-sm bg-surface'
                  }`}
                >
                  {(!mine || !conversation.mine) && (
                    <p className={`mb-0.5 text-xs font-semibold ${mine ? '' : 'text-brand'}`}>
                      {m.senderName}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className={`mt-1 text-[10px] tnum ${mine ? 'opacity-80' : 'text-faint'}`}>
                    {formatDateTime(m.at, locale)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={end} />
      </div>
      {!conversation.mine ? (
        <p className="border-t border-line bg-surface-2 px-3 py-2 text-center text-xs text-muted">
          {t('chat.readOnly')}
        </p>
      ) : muted ? (
        <p className="border-t border-line bg-warning-soft px-3 py-2 text-center text-xs text-warning">
          {t('chat.muted')}
        </p>
      ) : (
        canWrite && (
          <div className="border-t border-line p-2">
            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                value={text}
                maxLength={4000}
                placeholder={t('chat.write')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                className="max-h-32 min-h-10 flex-1 resize-none rounded-[var(--radius-app)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <Button icon="send" loading={sending} disabled={!text.trim()} onClick={send}>
                {t('chat.send')}
              </Button>
            </div>
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        )
      )}
    </div>
  );
}

/** Pick a colleague to talk to, or the members of a group. */
function PeopleSheet({
  mode,
  editing,
  me,
  onClose,
  onOpened,
}: {
  mode: 'direct' | 'group' | 'edit';
  editing: ChatConversation | null;
  me: string;
  onClose: () => void;
  onOpened: (id: string) => void;
}) {
  const { t } = useT();
  const people = useChatPeople();
  const actions = useChatActions();
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [picked, setPicked] = useState<Set<string>>(
    new Set((editing?.members ?? []).map((m) => m.id).filter((id) => id !== me)),
  );
  const [error, setError] = useState<string | null>(null);
  const shown = (people.data ?? []).filter(
    (p) =>
      p.id !== me &&
      (!search.trim() ||
        p.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        String(p.code) === search.trim()),
  );
  const run = async (fn: () => Promise<{ id: string }>) => {
    setError(null);
    try {
      onOpened((await fn()).id);
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <Sheet
      title={t(
        mode === 'direct' ? 'chat.new' : mode === 'group' ? 'chat.newGroup' : 'chat.editGroup',
      )}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <div className="space-y-3">
        {mode !== 'direct' && (
          <label className="block">
            <span className="mb-0.5 block text-xs text-muted">{t('chat.groupName')}</span>
            <input
              className="h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        <input
          type="search"
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-[var(--radius-app)] border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
        />
        <ul className="max-h-[50vh] divide-y divide-[var(--c-line)] overflow-y-auto rounded-[var(--radius-app)] border border-line">
          {shown.map((p: ChatPerson) => (
            <li key={p.id}>
              {mode === 'direct' ? (
                <button
                  type="button"
                  onClick={() => void run(() => actions.direct(p.id))}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm hover:bg-surface-2"
                >
                  <span className="text-xs text-muted tnum">{p.code}</span>
                  <span className="flex-1 font-medium">{p.name}</span>
                  {p.muted && <Badge tone="warning">{t('chat.mutedTag')}</Badge>}
                </button>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={picked.has(p.id)}
                    onChange={() =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                  />
                  <span className="text-xs text-muted tnum">{p.code}</span>
                  <span className="flex-1 font-medium">{p.name}</span>
                </label>
              )}
            </li>
          ))}
        </ul>
        {mode !== 'direct' && (
          <Button
            icon="check"
            disabled={!title.trim() || picked.size === 0}
            onClick={() =>
              void run(() => actions.group(title.trim(), [...picked, me], editing?.id))
            }
          >
            {t('common.save')}
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </Sheet>
  );
}

/** Who may write in the chat (chat:manage): stop or allow each person. */
function MutesSheet({ me, onClose }: { me: string; onClose: () => void }) {
  const { t } = useT();
  const people = useChatPeople();
  const actions = useChatActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={t('chat.writing')} onClose={onClose} closeLabel={t('common.close')}>
      <ul className="divide-y divide-[var(--c-line)] rounded-[var(--radius-app)] border border-line">
        {(people.data ?? [])
          .filter((p) => p.id !== me)
          .map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="text-xs text-muted tnum">{p.code}</span>
              <span className="flex-1 font-medium">{p.name}</span>
              {p.muted ? (
                <Badge tone="warning">{t('chat.mutedTag')}</Badge>
              ) : (
                <Badge tone="positive">{t('chat.allowedTag')}</Badge>
              )}
              <Button
                size="sm"
                variant={p.muted ? 'primary' : 'secondary'}
                loading={busy === p.id}
                onClick={async () => {
                  setBusy(p.id);
                  setError(null);
                  try {
                    await actions.mute(p.id, !p.muted);
                  } catch (e) {
                    setError(errorText(t, e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t(p.muted ? 'chat.allow' : 'chat.stop')}
              </Button>
            </li>
          ))}
      </ul>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Sheet>
  );
}

/** In the list, short: the time for today's, else the day and month (the full time is its tooltip). */
function listTime(iso: string, locale: 'ar' | 'en'): string {
  const at = new Date(iso);
  const intl = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US';
  return at.toDateString() === new Date().toDateString()
    ? at.toLocaleTimeString(intl, { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString(intl, { day: 'numeric', month: 'short' });
}
