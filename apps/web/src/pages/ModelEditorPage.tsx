import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, formatNumber, type ModelDetail, type VariantOption } from '@skb/shared';
import { Badge, Button, Card, PageHeader, Spinner } from '../components/ui';
import { NameFields, changedNames, namesFrom, type NameValues } from '../components/NameFields';
import {
  UnitsEditor,
  unitRowsToInput,
  unitRowsValid,
  type UnitRow,
} from '../components/UnitsEditor';
import { PriceGrid, inputsFrom, priceChanges, type PriceInputs } from '../components/PriceGrid';
import { SupplierFields } from '../components/SupplierFields';
import { useT } from '../lib/i18n';
import { useCan } from '../lib/can';
import { api, ApiError } from '../lib/api';
import { useWorkDraft } from '../lib/workDraft';
import {
  useCategories,
  useCompanySettings,
  useCreateModel,
  useModel,
  usePriceLevels,
  useSetModelPrices,
  useUnits,
  useUpdateModel,
  useVariantOptions,
} from '../lib/queries';
import { TableColumns } from '../components/TableColumns';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

/** Which version of the model the form was filled from. */
const stampOf = (m: ModelDetail) =>
  `${m.id}:${m.variants.length}:${m.units.length}:${m.prices.map((p) => p.own).join()}:${m.name}:${m.supplierId}:${m.supplierCode}`;

/** What is kept of a model being added or changed. */
interface ModelDraft {
  names: NameValues;
  code: string;
  categoryId: string;
  reorder: string;
  supplierId: string;
  supplierCode: string;
  sizeIds: string[];
  colorIds: string[];
  rows: UnitRow[];
  prices: PriceInputs;
}

const rowsFrom = (m: ModelDetail): UnitRow[] =>
  m.units.map((u) => ({ unitId: u.unitId, factor: u.factor, barcode: '' }));

/**
 * Add or edit an item model (موديل) made in sizes × colors. Creating makes one item per size/color
 * pair; each is its own item with its own SKU, barcode and stock. The model's category, units and
 * prices are shared: a size/color charges the model's prices until it is given its own (on its
 * item page). Adding sizes or colors later adds the missing items.
 */
export function ModelEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const canFields = can(isNew ? 'products:create' : 'products:edit');
  const canPrices = can('prices:edit');

  const model = useModel(id ?? null);
  const units = useUnits();
  const categories = useCategories();
  const options = useVariantOptions();
  const levels = usePriceLevels();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const create = useCreateModel();
  const update = useUpdateModel();
  const setPrices = useSetModelPrices();

  const [names, setNames] = useState<NameValues>('');
  const [code, setCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [reorder, setReorder] = useState('0');
  const [supplierId, setSupplierId] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [sizeIds, setSizeIds] = useState<string[]>([]);
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [prices, setPricesInput] = useState<PriceInputs>({});
  const [loaded, setLoaded] = useState('');

  const m = model.data;
  useEffect(() => {
    const stamp = m ? stampOf(m) : '';
    if (!m || loaded === stamp) return;
    setNames(namesFrom(m.name));
    setCategoryId(m.categoryId);
    setReorder(String(m.reorderLevel));
    setSupplierId(m.supplierId ?? '');
    setSupplierCode(m.supplierCode ?? '');
    setRows(rowsFrom(m));
    setPricesInput(inputsFrom(m.prices));
    setSizeIds([]);
    setColorIds([]);
    setLoaded(stamp);
  }, [m, loaded]);

  useEffect(() => {
    if (!isNew || rows.length > 0 || !units.data) return;
    const piece =
      units.data.find((u) => (u.name === 'قطعة' || u.name === 'Piece') && u.isActive) ??
      units.data.find((u) => u.isActive);
    if (piece) setRows([{ unitId: piece.id, factor: 1, barcode: '' }]);
  }, [isNew, rows.length, units.data]);

  const gridUnits = useMemo(
    () =>
      rows
        .map((r, i) => ({ ...r, factor: i === 0 ? 1 : r.factor }))
        .filter((r, i) => r.unitId && (i === 0 || r.factor >= 2))
        .sort((a, b) => a.factor - b.factor)
        .map((r) => ({
          unitId: r.unitId,
          factor: r.factor,
          name: units.data?.find((u) => u.id === r.unitId)?.name ?? '',
        })),
    [rows, units.data],
  );

  const allSizes = (options.data ?? []).filter((o) => o.kind === 'SIZE' && o.isActive);
  const allColors = (options.data ?? []).filter((o) => o.kind === 'COLOR' && o.isActive);
  const hasSizes = isNew || (m?.sizes.length ?? 0) > 0;
  const hasColors = isNew || (m?.colors.length ?? 0) > 0;
  const freeSizes = allSizes.filter((o) => !m?.sizes.some((s) => s.id === o.id));
  const freeColors = allColors.filter((o) => !m?.colors.some((c) => c.id === o.id));

  const sizeCount = (m?.sizes.length ?? 0) + sizeIds.length;
  const colorCount = (m?.colors.length ?? 0) + colorIds.length;
  const totalItems = Math.max(1, sizeCount) * Math.max(1, colorCount);
  const newItems = isNew
    ? sizeCount + colorCount > 0
      ? totalItems
      : 0
    : totalItems - (m?.variants.length ?? 0);

  const error = (create.error ?? update.error ?? setPrices.error) as ApiError | null;
  const pending = create.isPending || update.isPending || setPrices.isPending;
  const typedNames = changedNames(names, isNew ? null : m?.name);
  const unitsInput = unitRowsToInput(rows, false);
  const priceList = priceChanges(
    prices,
    isNew ? undefined : m?.prices,
    gridUnits,
    levels.data ?? [],
  );
  // Changed from what was loaded (or anything typed on a new model).
  const dirty = isNew
    ? !!names.trim() ||
      !!code.trim() ||
      !!supplierCode.trim() ||
      sizeIds.length + colorIds.length > 0 ||
      priceList.some((p) => p.price !== null)
    : !!m &&
      (!!typedNames.name ||
        categoryId !== m.categoryId ||
        Math.max(0, Math.floor(Number(reorder) || 0)) !== m.reorderLevel ||
        supplierId !== (m.supplierId ?? '') ||
        supplierCode.trim() !== (m.supplierCode ?? '') ||
        sizeIds.length + colorIds.length > 0 ||
        JSON.stringify(unitsInput) !== JSON.stringify(unitRowsToInput(rowsFrom(m), false)) ||
        priceList.length > 0);

  // Kept on the server while it is written, brought back after a crash or on another device.
  const qc = useQueryClient();
  const work = useWorkDraft<ModelDraft>(
    1,
    () =>
      dirty
        ? {
            names,
            code,
            categoryId,
            reorder,
            supplierId,
            supplierCode,
            sizeIds,
            colorIds,
            rows,
            prices,
          }
        : null,
    async (k) => {
      // A model being changed: fill from the server first, so that doesn't overwrite the work.
      if (id) {
        const fresh = await qc.fetchQuery({
          queryKey: ['catalog', 'model', id],
          queryFn: () => api.get<ModelDetail>(`/models/${id}`),
        });
        setLoaded(stampOf(fresh));
      }
      if (typeof k.names === 'string') setNames(k.names);
      if (typeof k.code === 'string') setCode(k.code);
      if (typeof k.categoryId === 'string') setCategoryId(k.categoryId);
      if (typeof k.reorder === 'string') setReorder(k.reorder);
      if (typeof k.supplierId === 'string') setSupplierId(k.supplierId);
      if (typeof k.supplierCode === 'string') setSupplierCode(k.supplierCode);
      if (Array.isArray(k.sizeIds)) setSizeIds(k.sizeIds);
      if (Array.isArray(k.colorIds)) setColorIds(k.colorIds);
      if (Array.isArray(k.rows) && k.rows.length) setRows(k.rows);
      if (k.prices && typeof k.prices === 'object') setPricesInput(k.prices);
    },
  );

  const canSave = isNew
    ? canFields &&
      !!typedNames.name &&
      !!categoryId &&
      unitRowsValid(rows) &&
      sizeIds.length + colorIds.length > 0 &&
      !pending
    : !!m && !pending && unitRowsValid(rows);

  async function save() {
    try {
      if (isNew) {
        const created = await create.mutateAsync({
          ...typedNames,
          categoryId,
          code: code.trim() || undefined,
          reorderLevel: Math.max(0, Math.floor(Number(reorder) || 0)),
          supplierId: supplierId || undefined,
          supplierCode: supplierCode.trim() || undefined,
          sizeIds,
          colorIds,
          units: unitsInput,
          prices: canPrices ? priceList.filter((p) => p.price !== null) : undefined,
        });
        work.finished();
        navigate(`/inventory/models/${created.id}`, { replace: true });
        return;
      }
      if (!m) return;
      if (canFields) {
        const input: Parameters<typeof update.mutateAsync>[0]['input'] = { ...typedNames };
        if (categoryId !== m.categoryId) input.categoryId = categoryId;
        const nextReorder = Math.max(0, Math.floor(Number(reorder) || 0));
        if (nextReorder !== m.reorderLevel) input.reorderLevel = nextReorder;
        if (supplierId !== (m.supplierId ?? '')) input.supplierId = supplierId;
        if (supplierCode.trim() !== (m.supplierCode ?? ''))
          input.supplierCode = supplierCode.trim();
        if (sizeIds.length) input.addSizeIds = sizeIds;
        if (colorIds.length) input.addColorIds = colorIds;
        const before = JSON.stringify(
          unitRowsToInput(rowsFrom(m), false).sort((a, b) => a.factor - b.factor),
        );
        if (JSON.stringify([...unitsInput].sort((a, b) => a.factor - b.factor)) !== before)
          input.units = unitsInput;
        if (Object.keys(input).length > 0) await update.mutateAsync({ id: m.id, input });
      }
      if (canPrices && priceList.length > 0)
        await setPrices.mutateAsync({ id: m.id, input: { prices: priceList } });
      setSizeIds([]);
      setColorIds([]);
    } catch {
      /* shown below */
    }
  }

  async function setActive(isActive: boolean) {
    if (!m) return;
    try {
      await update.mutateAsync({ id: m.id, input: { isActive } });
    } catch {
      /* shown below */
    }
  }

  if (!isNew && model.isLoading) {
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isNew ? t('model.new') : (m?.name ?? '')}
        subtitle={m ? `${m.code} · ${m.categoryName}` : t('model.subtitle')}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={() => navigate('/inventory/models')}
          >
            {t('common.back')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,340px)]">
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t('item.details')}
            </h2>
            <fieldset disabled={!canFields} className="space-y-3">
              <NameFields
                values={names}
                onChange={setNames}
                label={t('model.name')}
                placeholder={isNew ? t('model.namePlaceholder') : undefined}
                autoFocus={isNew}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('model.code')}</span>
                  <input
                    className={`${field} uppercase placeholder:normal-case`}
                    dir="ltr"
                    placeholder={t('item.auto')}
                    title={t('model.codeHint')}
                    value={isNew ? code : (m?.code ?? '')}
                    disabled={!isNew}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('item.category')}</span>
                  <select
                    className={field}
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">{t('item.pickCategory')}</option>
                    {(categories.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('item.reorder')}</span>
                  <input
                    type="number"
                    min={0}
                    className={`${field} tnum`}
                    value={reorder}
                    onChange={(e) => setReorder(e.target.value)}
                  />
                </label>
              </div>
              <div className="mt-3">
                <SupplierFields
                  supplierId={supplierId}
                  currentName={m?.supplierName}
                  onSupplier={setSupplierId}
                />
              </div>
            </fieldset>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {isNew ? t('model.variants') : t('model.addOptions')}
            </h2>
            <fieldset disabled={!canFields} className="space-y-3">
              {hasSizes && (
                <OptionChips
                  label={t('model.sizes')}
                  fixed={m?.sizes ?? []}
                  free={isNew ? allSizes : freeSizes}
                  picked={sizeIds}
                  onChange={setSizeIds}
                />
              )}
              {hasColors && (
                <OptionChips
                  label={t('model.colors')}
                  fixed={m?.colors ?? []}
                  free={isNew ? allColors : freeColors}
                  picked={colorIds}
                  onChange={setColorIds}
                />
              )}
            </fieldset>
            {(options.data ?? []).length === 0 && (
              <p className="text-xs text-muted">{t('model.noOptions')}</p>
            )}
            {newItems > 0 && (
              <p className="text-sm">
                {t('model.willCreate')}:{' '}
                <span className="font-semibold tnum">{formatNumber(newItems, locale)}</span>
              </p>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t('item.units')}
            </h2>
            <fieldset disabled={!canFields}>
              <UnitsEditor
                units={units.data ?? []}
                rows={rows}
                onChange={setRows}
                withBarcodes={false}
                baseLocked={!!m?.hasMovements}
              />
            </fieldset>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t('item.prices')}
            </h2>
            <PriceGrid
              units={gridUnits}
              levels={levels.data ?? []}
              inputs={prices}
              onChange={setPricesInput}
              saved={m?.prices}
              currency={currency}
              readOnly={!canPrices}
            />
          </Card>

          {m && m.variants.length > 0 && <VariantGrid model={m} />}
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card className="space-y-3">
            {m && !m.isActive && (
              <div className="flex justify-end">
                <Badge>{t('item.closed')}</Badge>
              </div>
            )}
            {isNew && sizeIds.length + colorIds.length === 0 && (
              <p className="text-xs text-muted">{t('model.pickOptions')}</p>
            )}
            {error && (
              <p className="rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {error.message}
              </p>
            )}
            <Button
              className="w-full"
              icon="check"
              loading={pending}
              disabled={!canSave}
              onClick={save}
            >
              {pending ? t('item.saving') : t('model.save')}
            </Button>
            {m && canFields && (
              <Button
                className="w-full"
                variant={m.isActive ? 'ghost' : 'secondary'}
                disabled={pending || (m.isActive && m.variants.some((v) => v.stockOnHand !== 0))}
                onClick={() => setActive(!m.isActive)}
              >
                {m.isActive ? t('model.close') : t('model.reopen')}
              </Button>
            )}
          </Card>
          {m && (
            <Card>
              <p className="text-xs text-muted">{t('item.stock')}</p>
              <p className="text-lg font-semibold tnum">
                {formatNumber(
                  m.variants.reduce((s, v) => s + v.stockOnHand, 0),
                  locale,
                )}{' '}
                {m.units[0]?.name}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Sizes or colors of a model: the ones it has (fixed) and the ones that can be added (toggle). */
function OptionChips({
  label,
  fixed,
  free,
  picked,
  onChange,
}: {
  label: string;
  fixed: VariantOption[];
  free: VariantOption[];
  picked: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {fixed.map((o) => (
          <span
            key={o.id}
            className="inline-flex h-8 items-center rounded-full bg-brand-soft px-3 text-sm text-brand"
          >
            {o.name}
          </span>
        ))}
        {free.map((o) => {
          const on = picked.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? picked.filter((x) => x !== o.id) : [...picked, o.id])}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors disabled:opacity-60 ${
                on
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-line bg-surface text-muted hover:text-fg'
              }`}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Every size × color item of the model: SKU, stock and price; tap one to open its item card. */
function VariantGrid({ model }: { model: ModelDetail }) {
  const { t, locale } = useT();
  const rowsOf = model.colors.length > 0 ? model.colors : [null];
  const colsOf = model.sizes.length > 0 ? model.sizes : [null];
  const find = (colorId?: string, sizeId?: string) =>
    model.variants.find(
      (v) => (v.colorId ?? undefined) === colorId && (v.sizeId ?? undefined) === sizeId,
    );

  return (
    <Card padded={false} className="overflow-hidden">
      <h2 className="border-b border-line p-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {t('model.variants')}
      </h2>
      <div className="overflow-x-auto">
        <TableColumns id="model.variants">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="p-2 text-start font-medium">
                  {model.colors.length > 0 ? t('model.colors') : ''}
                </th>
                {colsOf.map((s) => (
                  <th key={s?.id ?? 'none'} className="p-2 text-start font-medium">
                    {s?.name ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-line)]">
              {rowsOf.map((c) => (
                <tr key={c?.id ?? 'none'}>
                  <td className="p-2 font-medium">{c?.name ?? ''}</td>
                  {colsOf.map((s) => {
                    const v = find(c?.id, s?.id);
                    return (
                      <td key={s?.id ?? 'none'} className="p-1.5 align-top">
                        {v ? (
                          <Link
                            to={`/inventory/items/${v.productId}`}
                            className={`block rounded-[var(--radius-app)] border border-line p-2 hover:bg-surface-2 ${v.isActive ? '' : 'opacity-50'}`}
                          >
                            <span className="block truncate text-xs text-muted tnum" dir="ltr">
                              {v.sku}
                            </span>
                            <span className="block font-semibold tnum">
                              {formatNumber(v.stockOnHand, locale)}
                            </span>
                            <span className="block text-xs tnum">
                              {formatMoney(v.salePrice, model.currency, locale)}
                            </span>
                            {v.ownPrices && <Badge tone="info">{t('model.ownPrice')}</Badge>}
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableColumns>
      </div>
    </Card>
  );
}
