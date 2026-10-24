import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber, type ProductDetail } from '@skb/shared';
import { Badge, Button, Card, PageHeader, Spinner } from '../components/ui';
import { NameFields, changedNames, namesFrom, type NameValues } from '../components/NameFields';
import {
  UnitsEditor,
  unitRowsToInput,
  unitRowsValid,
  type UnitRow,
} from '../components/UnitsEditor';
import {
  PriceGrid,
  cellKey,
  inputsFrom,
  priceChanges,
  type PriceInputs,
} from '../components/PriceGrid';
import { ProductImageCard } from '../components/ProductImage';
import { SupplierFields } from '../components/SupplierFields';
import { useT } from '../lib/i18n';
import { onlyChoice } from '../lib/onlyChoice';
import { useCan } from '../lib/can';
import { api, ApiError } from '../lib/api';
import { useWorkDraft } from '../lib/workDraft';
import {
  useDepartments,
  useGroups,
  useSeasons,
  useVariantOptions,
  useCompanySettings,
  useCreateProduct,
  usePriceLevels,
  useProductDetail,
  useSetProductPrices,
  useUnits,
  useUpdateProduct,
} from '../lib/queries';
import { errorText } from '../lib/errors';
import { GroupPicker } from '../components/GroupTree';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

/** Which version of the item the form was filled from. */
const loadKey = (d: ProductDetail) =>
  `${d.id}:${d.sku}:${d.units.length}:${d.prices.map((p) => p.own).join()}:${d.supplierId}:${d.supplierCode}`;

/** What is kept of an item being added or changed. */
interface ProductDraft {
  names: NameValues;
  sku: string;
  departmentId: string;
  seasonId: string;
  reorder: string;
  supplierId: string;
  supplierCode: string;
  rows: UnitRow[];
  prices: PriceInputs;
}

const rowsFrom = (d: ProductDetail): UnitRow[] =>
  d.units.map((u) => ({ unitId: u.unitId, factor: u.factor, barcode: u.barcode ?? '' }));

/**
 * Add or edit an item (صنف): its name (as typed), SKU,
 * category, reorder level, the units it comes in with their barcodes, and its prices per unit and
 * price level. A size/color of a model only changes its SKU, barcodes, reorder level and prices
 * here — the rest follows the model. Each part needs its own permission.
 */
export function ProductEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const { t, locale } = useT();
  const navigate = useNavigate();
  const can = useCan();
  const canFields = can(isNew ? 'products:create' : 'products:edit');
  const canPrices = can('prices:edit');

  const detail = useProductDetail(id ?? null);
  const units = useUnits();
  const departments = (useDepartments().data ?? []).filter((x) => x.isActive);
  const seasons = useSeasons();
  const options = useVariantOptions();
  const levels = usePriceLevels();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const setPrices = useSetProductPrices();

  const [names, setNames] = useState<NameValues>('');
  const [sku, setSku] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  // The only department, when the company has just one (owner, 2026-10-19).
  const soleDepartment = onlyChoice(departments);
  useEffect(() => {
    if (!departmentId && soleDepartment) setDepartmentId(soleDepartment);
  }, [departmentId, soleDepartment]);
  // The group of the department's tree it sits in (owner, 2026-10-06); '' = the department itself.
  const [groupId, setGroupId] = useState('');
  const groups = useGroups().data ?? [];
  const [seasonId, setSeasonId] = useState('');
  const [sizeId, setSizeId] = useState('');
  const [colorId, setColorId] = useState('');
  const [reorder, setReorder] = useState('0');
  const [supplierId, setSupplierId] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [prices, setPricesInput] = useState<PriceInputs>({});
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [withVariant, setWithVariant] = useState(false);
  const [marginPct, setMarginPct] = useState('');
  const [marginAmt, setMarginAmt] = useState('');

  // Fill the form once the item has loaded (and again after a save returns fresh data).
  const d = detail.data;
  useEffect(() => {
    if (!d || loadedId === loadKey(d)) return;
    setNames(namesFrom(d.name));
    setSku(d.sku);
    setDepartmentId(d.departmentId ?? '');
    setGroupId(groups.some((g) => g.id === d.categoryId) ? d.categoryId : '');
    setSeasonId(d.seasonId ?? '');
    setReorder(String(d.reorderLevel));
    setSupplierId(d.supplierId ?? '');
    setSupplierCode(d.supplierCode ?? '');
    setRows(rowsFrom(d));
    setPricesInput(inputsFrom(d.prices));
    setLoadedId(loadKey(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, loadedId, groups.length]);

  // A new item starts in the season it is now (owner decision 2026-10-01).
  const currentSeason = seasons.data?.find((x) => x.isCurrent)?.id;
  useEffect(() => {
    if (isNew && !seasonId && currentSeason) setSeasonId(currentSeason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, currentSeason]);

  // A new item starts in pieces.
  useEffect(() => {
    if (!isNew || rows.length > 0 || !units.data) return;
    // The unit of one piece, whatever it is called (owner, 2026-10-24: renaming it kept no default).
    const piece =
      units.data.find((u) => u.isActive && (u.pieces ?? 1) === 1) ??
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

  // The base unit's purchase and sale prices, typed like on the add-items screen (owner,
  // 2026-10-17); the margin (a percent and an amount, on the purchase price) fills the sale price.
  const baseUnit = rows[0]?.unitId;
  const saleLevel = (levels.data ?? []).find((l) => l.side === 'SALE' && l.isDefault);
  const purchaseLevel = (levels.data ?? []).find((l) => l.side === 'PURCHASE' && l.isDefault);
  const quick =
    baseUnit && saleLevel && purchaseLevel
      ? { cost: cellKey(baseUnit, purchaseLevel.id), sale: cellKey(baseUnit, saleLevel.id) }
      : null;
  const seePurchase = can('costs:view') || can('purchases:view');
  const quickPrices = (patch: { cost?: string; pct?: string; amt?: string }) => {
    if (!quick) return;
    const pctValue = patch.pct ?? marginPct;
    const amtValue = patch.amt ?? marginAmt;
    if (patch.pct !== undefined) setMarginPct(patch.pct);
    if (patch.amt !== undefined) setMarginAmt(patch.amt);
    setPricesInput((p) => {
      const cost = patch.cost ?? p[quick.cost] ?? '';
      const next = { ...p, [quick.cost]: cost };
      if ((pctValue || amtValue) && Number(cost) > 0) {
        const sale = Number(cost) * (1 + (Number(pctValue) || 0) / 100) + (Number(amtValue) || 0);
        next[quick.sale] = String(Math.ceil(Math.round(sale * 100) / 100)); // whole pounds, rounded up
      }
      return next;
    });
  };

  const isVariant = !!d?.modelId;
  const error = (create.error ?? update.error ?? setPrices.error) as ApiError | null;
  const pending = create.isPending || update.isPending || setPrices.isPending;
  const typedNames = changedNames(names, isNew ? null : d?.name);
  const unitsInput = unitRowsToInput(rows);
  const unitsValid = unitRowsValid(rows);
  const priceList = priceChanges(
    prices,
    isNew ? undefined : d?.prices,
    gridUnits,
    levels.data ?? [],
  );

  // Changed from what was loaded (or anything typed on a new item).
  const nextReorder = Math.max(0, Math.floor(Number(reorder) || 0));
  const dirty = isNew
    ? !!names.trim() ||
      !!sku.trim() ||
      !!supplierCode.trim() ||
      priceList.some((p) => p.price !== null)
    : !!d &&
      (!!typedNames.name ||
        (!!sku.trim() && sku.trim() !== d.sku) ||
        departmentId !== (d.departmentId ?? '') ||
        groupId !== (groups.some((g) => g.id === d.categoryId) ? d.categoryId : '') ||
        seasonId !== (d.seasonId ?? '') ||
        nextReorder !== d.reorderLevel ||
        supplierId !== (d.supplierId ?? '') ||
        supplierCode.trim() !== (d.supplierCode ?? '') ||
        JSON.stringify(unitRowsToInput(rows)) !== JSON.stringify(unitRowsToInput(rowsFrom(d))) ||
        priceList.length > 0);

  // Kept on the server while it is written, brought back after a crash or on another device.
  const qc = useQueryClient();
  const work = useWorkDraft<ProductDraft>(
    2,
    () =>
      dirty
        ? { names, sku, departmentId, seasonId, reorder, supplierId, supplierCode, rows, prices }
        : null,
    async (k) => {
      // An item being changed: fill from the server first, so that doesn't overwrite the work.
      if (id) {
        const fresh = await qc.fetchQuery({
          queryKey: ['catalog', 'product', id],
          queryFn: () => api.get<ProductDetail>(`/products/${id}`),
        });
        setLoadedId(loadKey(fresh));
      }
      if (typeof k.names === 'string') setNames(k.names);
      if (typeof k.sku === 'string') setSku(k.sku);
      if (typeof k.departmentId === 'string') setDepartmentId(k.departmentId);
      if (typeof k.seasonId === 'string') setSeasonId(k.seasonId);
      if (typeof k.reorder === 'string') setReorder(k.reorder);
      if (typeof k.supplierId === 'string') setSupplierId(k.supplierId);
      if (typeof k.supplierCode === 'string') setSupplierCode(k.supplierCode);
      if (Array.isArray(k.rows) && k.rows.length) setRows(k.rows);
      if (k.prices && typeof k.prices === 'object') setPricesInput(k.prices);
    },
  );

  const canSave = isNew
    ? canFields && !!typedNames.name && !!departmentId && unitsValid && !pending
    : !pending && !!d && unitsValid;

  async function save() {
    try {
      if (isNew) {
        const created = await create.mutateAsync({
          ...typedNames,
          departmentId,
          groupId: groupId || undefined,
          seasonId: seasonId || undefined,
          sizeId: sizeId || undefined,
          colorId: colorId || undefined,
          sku: sku.trim() || undefined,
          reorderLevel: Math.max(0, Math.floor(Number(reorder) || 0)),
          supplierId: supplierId || undefined,
          supplierCode: supplierCode.trim() || undefined,
          units: unitsInput,
          prices: canPrices ? priceList.filter((p) => p.price !== null) : undefined,
        });
        work.finished();
        navigate(`/inventory/items/${created.id}`);
        return;
      }
      if (!d) return;
      if (canFields) {
        const input: Parameters<typeof update.mutateAsync>[0]['input'] = {};
        if (!isVariant) Object.assign(input, typedNames);
        if (sku.trim() && sku.trim() !== d.sku) input.sku = sku.trim();
        const wasGroup = groups.some((g) => g.id === d.categoryId) ? d.categoryId : '';
        if (
          !isVariant &&
          departmentId &&
          (departmentId !== (d.departmentId ?? '') || groupId !== wasGroup)
        ) {
          input.departmentId = departmentId;
          if (groupId) input.groupId = groupId;
        }
        if (seasonId !== (d.seasonId ?? '')) input.seasonId = seasonId;
        if (nextReorder !== d.reorderLevel) input.reorderLevel = nextReorder;
        if (!isVariant && supplierId !== (d.supplierId ?? '')) input.supplierId = supplierId;
        if (!isVariant && supplierCode.trim() !== (d.supplierCode ?? ''))
          input.supplierCode = supplierCode.trim();
        const before = JSON.stringify(
          unitRowsToInput(rowsFrom(d)).sort((a, b) => a.factor - b.factor),
        );
        if (JSON.stringify([...unitsInput].sort((a, b) => a.factor - b.factor)) !== before)
          input.units = unitsInput;
        if (Object.keys(input).length > 0) await update.mutateAsync({ id: d.id, input });
      }
      if (canPrices && priceList.length > 0)
        await setPrices.mutateAsync({ id: d.id, input: { prices: priceList } });
      work.finished();
      navigate(`/inventory/items/${d.id}`);
    } catch {
      /* shown below */
    }
  }

  async function setActive(isActive: boolean) {
    if (!d) return;
    try {
      await update.mutateAsync({ id: d.id, input: { isActive } });
    } catch {
      /* shown below */
    }
  }

  if (!isNew && detail.isLoading) {
    return (
      <div className="grid place-items-center py-24 text-muted">
        <Spinner size={26} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isNew ? t('item.new') : (d?.name ?? t('item.edit'))}
        subtitle={isNew ? undefined : t('item.edit')}
        action={
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={() => navigate(isNew ? '/inventory' : `/inventory/items/${id}`)}
          >
            {t('common.back')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,340px)]">
        <div className="min-w-0 space-y-4">
          {/* Laid out like the item on the add-items screen (owner, 2026-10-17): the place in the
              tree, then name, code and reorder level, the season, the prices with the margin,
              size and color behind a button, the supplier and the photo. */}
          <Card className="space-y-3">
            {isVariant && d ? (
              <div className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
                <p className="text-xs text-muted">{t('item.variantOf')}</p>
                <p className="font-medium">{d.modelName}</p>
                <p className="text-xs text-muted">
                  {[d.colorName, d.sizeName].filter(Boolean).join(' / ')}
                </p>
                <Link
                  className="mt-1 inline-block text-xs font-medium text-brand hover:underline"
                  to={`/inventory/models/${d.modelId}`}
                >
                  {t('item.openModel')}
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-app)] bg-surface-2 p-2">
                <span className="text-xs text-muted">{t('groups.path')}</span>
                <GroupPicker
                  departments={
                    d?.departmentId &&
                    departments.length > 0 &&
                    !departments.some((x) => x.id === d.departmentId)
                      ? [
                          ...departments,
                          {
                            ...departments[0]!,
                            id: d.departmentId,
                            name: d.departmentName ?? '',
                          },
                        ]
                      : departments
                  }
                  groups={groups}
                  departmentId={departmentId}
                  groupId={groupId}
                  onChange={(dep, g) => {
                    if (!canFields) return;
                    setDepartmentId(dep);
                    setGroupId(g);
                  }}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
              {!isVariant && (
                <NameFields
                  values={names}
                  onChange={setNames}
                  label={t('item.name')}
                  placeholder={isNew ? t('item.namePlaceholder') : undefined}
                  autoFocus={isNew}
                />
              )}
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('additems.code')}</span>
                <input
                  className={`${field} font-mono uppercase placeholder:normal-case`}
                  dir="ltr"
                  placeholder={t('item.auto')}
                  value={sku}
                  disabled={!canFields}
                  onChange={(e) => setSku(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('item.reorder')}</span>
                <input
                  type="number"
                  min={0}
                  className={`${field} tnum`}
                  value={reorder}
                  disabled={!canFields}
                  onChange={(e) => setReorder(e.target.value)}
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('item.season')}</span>
                <select
                  className={field}
                  value={seasonId}
                  disabled={!canFields}
                  onChange={(e) => setSeasonId(e.target.value)}
                >
                  <option value="">—</option>
                  {(seasons.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              {quick && seePurchase && (
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">
                    {t('additems.costBefore')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${field} tnum`}
                    value={prices[quick.cost] ?? ''}
                    disabled={!canPrices}
                    onChange={(e) => quickPrices({ cost: e.target.value })}
                  />
                </label>
              )}
              {quick && seePurchase && (
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('additems.marginPct')}</span>
                  <input
                    type="number"
                    step="0.01"
                    className={`${field} tnum`}
                    value={marginPct}
                    disabled={!canPrices}
                    onChange={(e) => quickPrices({ pct: e.target.value })}
                  />
                </label>
              )}
              {quick && seePurchase && (
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('additems.marginAmt')}</span>
                  <input
                    type="number"
                    step="0.01"
                    className={`${field} tnum`}
                    value={marginAmt}
                    disabled={!canPrices}
                    onChange={(e) => quickPrices({ amt: e.target.value })}
                  />
                </label>
              )}
              {quick && (
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">{t('item.salePrice')}</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${field} tnum`}
                    value={prices[quick.sale] ?? ''}
                    disabled={!canPrices}
                    onChange={(e) =>
                      setPricesInput((p) => ({ ...p, [quick.sale]: e.target.value }))
                    }
                  />
                </label>
              )}
            </div>
            {isNew &&
              (withVariant ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-0.5 block text-xs text-muted">{t('setup.sizeName')}</span>
                    <select
                      className={field}
                      value={sizeId}
                      onChange={(e) => setSizeId(e.target.value)}
                    >
                      <option value="">—</option>
                      {(options.data ?? [])
                        .filter((o) => o.kind === 'SIZE' && o.isActive)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-xs text-muted">{t('setup.colorName')}</span>
                    <select
                      className={field}
                      value={colorId}
                      onChange={(e) => setColorId(e.target.value)}
                    >
                      <option value="">—</option>
                      {(options.data ?? [])
                        .filter((o) => o.kind === 'COLOR' && o.isActive)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  onClick={() => setWithVariant(true)}
                >
                  {t('additems.addVariant')}
                </button>
              ))}
            <SupplierFields
              supplierId={supplierId}
              currentName={d?.supplierName}
              onSupplier={setSupplierId}
              disabled={!canFields || isVariant}
            />
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t('item.units')}
            </h2>
            {units.isLoading ? (
              <Spinner size={20} />
            ) : (
              <fieldset disabled={!canFields}>
                <UnitsEditor
                  units={units.data ?? []}
                  rows={rows}
                  onChange={setRows}
                  baseLocked={!!d?.hasMovements}
                  barcodesOnly={isVariant}
                />
              </fieldset>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t('item.prices')}
            </h2>
            <PriceGrid
              units={gridUnits}
              levels={(levels.data ?? [])
                .filter((l) => l.isDefault && l.isActive)
                .map((l) => ({
                  ...l,
                  name: t(l.side === 'SALE' ? 'item.salePrice' : 'item.purchasePrice'),
                }))}
              inputs={prices}
              onChange={setPricesInput}
              saved={d?.prices}
              currency={currency}
              readOnly={!canPrices}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:h-fit">
          {!isNew && id && <ProductImageCard productId={id} canEdit={canFields} />}
          <Card className="space-y-3">
            {d && (
              <dl className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted">{t('item.stock')}</dt>
                  <dd className="font-semibold tnum">
                    {formatNumber(d.stockOnHand, locale)} {d.units[0]?.name}
                  </dd>
                </div>
                {!d.isActive && (
                  <div className="flex justify-end">
                    <Badge>{t('item.closed')}</Badge>
                  </div>
                )}
              </dl>
            )}
            {error && (
              <p className="rounded-[var(--radius-app)] bg-destructive-soft p-2 text-xs text-destructive">
                {errorText(t, error)}
              </p>
            )}
            <Button
              className="w-full"
              icon="check"
              loading={pending}
              disabled={!canSave}
              onClick={save}
            >
              {pending ? t('item.saving') : t('item.save')}
            </Button>
            {d && can('products:close') && (
              <>
                <Button
                  className="w-full"
                  variant={d.isActive ? 'ghost' : 'secondary'}
                  disabled={pending || (d.isActive && d.stockOnHand !== 0)}
                  onClick={() => setActive(!d.isActive)}
                >
                  {d.isActive ? t('item.close') : t('item.reopen')}
                </Button>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
