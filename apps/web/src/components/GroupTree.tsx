import { useMemo, useState } from 'react';
import { formatNumber, groupPath, type Department, type Group } from '@skb/shared';
import { Badge, Button, Card, EmptyState } from './ui';
import { Icon } from './Icon';
import { useT } from '../lib/i18n';
import { ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { useSaveGroup } from '../lib/queries';

const select =
  'h-9 min-w-0 rounded-[var(--radius-app)] border border-line bg-surface px-2 text-sm outline-none focus:border-brand';

/** The groups straight under a department or a group, in their order. */
export function childrenOf(groups: Group[], departmentId: string, parentId: string | null) {
  return groups
    .filter((g) => g.departmentId === departmentId && (g.parentId ?? null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** "رجالي / فانلة / نصف كم". */
export function groupLabel(groups: Group[], id: string | null | undefined) {
  return groupPath(groups, id)
    .map((g) => g.name)
    .join(' / ');
}

/**
 * Pick a department and then a group level by level (owner, 2026-10-06): each choice opens the next
 * level's list, so men's → vests → half sleeve is three short lists. Choosing "all" at a level stops
 * there. `showDepartment` false when the department is chosen elsewhere on the form.
 */
export function GroupPicker({
  departments,
  groups,
  departmentId,
  groupId,
  onChange,
  showDepartment = true,
  anyLabel,
  activeOnly = true,
  className = '',
}: {
  departments: Department[];
  groups: Group[];
  departmentId: string;
  groupId: string;
  onChange: (departmentId: string, groupId: string) => void;
  showDepartment?: boolean;
  /** What "nothing chosen" reads at each level (e.g. "الكل" in a filter). */
  anyLabel?: string;
  activeOnly?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const usable = activeOnly ? groups.filter((g) => g.isActive) : groups;
  const path = groupPath(usable, groupId);
  const levels: { parentId: string | null; value: string }[] = [];
  if (departmentId) {
    levels.push({ parentId: null, value: path[0]?.id ?? '' });
    path.forEach((g, i) => levels.push({ parentId: g.id, value: path[i + 1]?.id ?? '' }));
  }
  const any = anyLabel ?? t('groups.none');
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {showDepartment && (
        <select
          className={select}
          value={departmentId}
          aria-label={t('invoice.department')}
          onChange={(e) => onChange(e.target.value, '')}
        >
          <option value="">{anyLabel ?? t('invoice.chooseDepartment')}</option>
          {departments
            .filter((d) => d.isActive || d.id === departmentId)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
      )}
      {levels.map(({ parentId, value }) => {
        const options = childrenOf(usable, departmentId, parentId);
        if (options.length === 0) return null;
        return (
          <span key={parentId ?? 'top'} className="flex items-center gap-1.5">
            {(showDepartment || parentId) && (
              <Icon name="chevronRight" size={14} className="text-faint" />
            )}
            <select
              className={select}
              value={value}
              aria-label={t('groups.level')}
              onChange={(e) => onChange(departmentId, e.target.value || (parentId ?? ''))}
            >
              <option value="">{any}</option>
              {options.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </span>
        );
      })}
    </div>
  );
}

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand';

/** Keywords typed comma- or line-separated. */
const splitWords = (s: string) =>
  s
    .split(/[,،\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Add or change one group: its name, code prefix and the words that point to it. */
function GroupForm({
  departmentId,
  parentId,
  group,
  onDone,
}: {
  departmentId: string;
  parentId: string | null;
  group?: Group;
  onDone: () => void;
}) {
  const { t } = useT();
  const save = useSaveGroup();
  const [name, setName] = useState(group?.name ?? '');
  const [prefix, setPrefix] = useState(group?.prefix ?? '');
  const [keywords, setKeywords] = useState((group?.keywords ?? []).join('، '));
  const error = save.error as ApiError | null;
  const submit = async () => {
    try {
      await save.mutateAsync({
        id: group?.id,
        input: group
          ? { name: name.trim(), prefix: prefix.trim(), keywords: splitWords(keywords) }
          : {
              name: name.trim(),
              departmentId,
              parentId,
              prefix: prefix.trim() || undefined,
              keywords: splitWords(keywords),
            },
      });
      onDone();
    } catch {
      /* shown below */
    }
  };
  return (
    <div className="space-y-2 rounded-[var(--radius-app)] border border-brand/40 bg-brand-soft/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_120px_1.4fr]">
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('groups.name')}</span>
          <input
            autoFocus
            className={field}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && void submit()}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('setup.prefix')}</span>
          <input
            className={`${field} uppercase`}
            dir="ltr"
            maxLength={10}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted">{t('groups.keywords')}</span>
          <input className={field} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          icon="check"
          loading={save.isPending}
          disabled={!name.trim()}
          onClick={submit}
        >
          {t('common.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{errorText(t, error)}</p>}
    </div>
  );
}

/** One group with the groups under it. */
function GroupNode({
  group,
  groups,
  depth,
  canManage,
  path,
}: {
  group: Group;
  groups: Group[];
  depth: number;
  canManage: boolean;
  path: string;
}) {
  const { t, locale } = useT();
  const save = useSaveGroup();
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view');
  const [open, setOpen] = useState(true);
  const kids = childrenOf(groups, group.departmentId, group.id);
  const code = [path, group.prefix].filter(Boolean).join('-');
  return (
    <li>
      <div
        className={`flex flex-wrap items-center gap-2 py-2 pe-2 ${group.isActive ? '' : 'opacity-60'}`}
        style={{ paddingInlineStart: `${depth * 1.5 + 0.75}rem` }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={kids.length === 0}
          aria-label={t(open ? 'shell.collapse' : 'shell.expand')}
          className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-2 disabled:invisible"
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
        <span className="font-medium">{group.name}</span>
        {group.prefix && (
          <Badge tone="info">
            <span dir="ltr">{code}</span>
          </Badge>
        )}
        {!group.isActive && <Badge>{t('setup.closed')}</Badge>}
        <span className="text-xs text-muted tnum">
          {t('setup.itemCount')}: {formatNumber(group.itemCount, locale)}
        </span>
        {group.keywords.length > 0 && (
          <span className="text-xs text-faint">{group.keywords.join('، ')}</span>
        )}
        {canManage && mode === 'view' && (
          <span className="ms-auto flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setMode('add')}>
              {t('groups.addUnder')}
            </Button>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setMode('edit')}>
              {t('setup.rename')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={save.isPending}
              onClick={() => save.mutate({ id: group.id, input: { isActive: !group.isActive } })}
            >
              {t(group.isActive ? 'setup.close' : 'setup.reopen')}
            </Button>
          </span>
        )}
      </div>
      {mode !== 'view' && (
        <div className="pb-2 pe-2" style={{ paddingInlineStart: `${(depth + 1) * 1.5 + 0.75}rem` }}>
          <GroupForm
            departmentId={group.departmentId}
            parentId={mode === 'add' ? group.id : group.parentId}
            group={mode === 'edit' ? group : undefined}
            onDone={() => setMode('view')}
          />
        </div>
      )}
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <GroupNode
              key={k.id}
              group={k}
              groups={groups}
              depth={depth + 1}
              canManage={canManage}
              path={code}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The setup screen's tree: pick a department, then add and arrange its groups. */
export function GroupsSetup({
  departments,
  groups,
  canManage,
}: {
  departments: Department[];
  groups: Group[];
  canManage: boolean;
}) {
  const { t } = useT();
  const open = useMemo(() => departments.filter((d) => d.isActive), [departments]);
  const [chosen, setChosen] = useState('');
  const department = open.find((d) => d.id === chosen) ?? open[0];
  const [adding, setAdding] = useState(false);
  if (!department) return <EmptyState title={t('common.empty')} icon="inventory" />;
  const top = childrenOf(groups, department.id, null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {open.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => {
              setChosen(d.id);
              setAdding(false);
            }}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${
              d.id === department.id
                ? 'border-brand bg-brand-soft font-semibold text-brand'
                : 'border-line text-muted hover:text-fg'
            }`}
          >
            {d.name}
            {d.prefix && (
              <span className="text-xs opacity-70" dir="ltr">
                {d.prefix}
              </span>
            )}
          </button>
        ))}
      </div>
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="font-semibold">{department.name}</span>
          {canManage && !adding && (
            <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
              {t('groups.add')}
            </Button>
          )}
        </div>
        {adding && (
          <div className="p-3">
            <GroupForm
              departmentId={department.id}
              parentId={null}
              onDone={() => setAdding(false)}
            />
          </div>
        )}
        {top.length === 0 ? (
          !adding && <EmptyState title={t('groups.empty')} icon="inventory" />
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {top.map((g) => (
              <GroupNode
                key={g.id}
                group={g}
                groups={groups}
                depth={0}
                canManage={canManage}
                path={department.prefix ?? ''}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
