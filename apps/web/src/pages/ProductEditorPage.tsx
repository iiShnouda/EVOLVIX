import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatNumber, type ProductDetail } from '@skb/shared';
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
import { ApiError } from '../lib/api';
import {
  useCategories,
  useCompanySettings,
  useCreateProduct,
  usePriceLevels,
  useProductDetail,
  useSetProductPrices,
  useUnits,
  useUpdateProduct,
} from '../lib/queries';

const field =
  'h-9 w-full rounded-[var(--radius-app)] border border-line bg-surface px-2.5 text-sm outline-none focus:border-brand disabled:opacity-60';

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
  const categories = useCategories();
  const levels = usePriceLevels();
  const currency = useCompanySettings().data?.currency ?? 'EGP';
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const setPrices = useSetProductPrices();

  const [names, setNames] = useState<NameValues>('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [reorder, setReorder] = useState('0');
  const [supplierId, setSupplierId] = useState('');
  const [supplierCode, setSupplierCode] = useState('');
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [prices, setPricesInput] = useState<PriceInputs>({});
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Fill the form once the item has loaded (and again after a save returns fresh data).
  const d = detail.data;
  useEffect(() => {
    if (
      !d ||
      loadedId ===
        `${d.id}:${d.sku}:${d.units.length}:${d.prices.map((p) => p.own).join()}:${d.supplierId}:${d.supplierCode}`
    )
      return;
    setNames(namesFrom(d.name));
    setSku(d.sku);
    setCategoryId(d.categoryId);
    setReorder(String(d.reorderLevel));
    setSupplierId(d.supplierId ?? '');
    setSupplierCode(d.supplierCode ?? '');
    setRows(rowsFrom(d));
    setPricesInput(inputsFrom(d.prices));
    setLoadedId(
      `${d.id}:${d.sku}:${d.units.length}:${d.prices.map((p) => p.own).join()}:${d.supplierId}:${d.supplierCode}`,
    );
  }, [d, loadedId]);

  // A new item starts in pieces.
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

  const canSave = isNew
    ? canFields && !!typedNames.name && !!categoryId && unitsValid && !pending
    : !pending && !!d && unitsValid;

  async function save() {
    try {
      if (isNew) {
        const created = await create.mutateAsync({
          ...typedNames,
          categoryId,
          sku: sku.trim() || undefined,
          reorderLevel: Math.max(0, Math.floor(Number(reorder) || 0)),
          supplierId: supplierId || undefined,
          supplierCode: supplierCode.trim() || undefined,
          units: unitsInput,
          prices: canPrices ? priceList.filter((p) => p.price !== null) : undefined,
        });
        navigate(`/inventory/items/${created.id}`);
        return;
      }
      if (!d) return;
      if (canFields) {
        const input: Parameters<typeof update.mutateAsync>[0]['input'] = {};
        if (!isVariant) Object.assign(input, typedNames);
        if (sku.trim() && sku.trim() !== d.sku) input.sku = sku.trim();
        if (!isVariant && categoryId !== d.categoryId) input.categoryId = categoryId;
        const nextReorder = Math.max(0, Math.floor(Number(reorder) || 0));
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
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {t('item.details')}
            </h2>
            {isVariant && d ? (
              <div className="rounded-[var(--radius-app)] bg-surface-2 p-3 text-sm">
                <p className="text-xs text-muted">{t('item.variantOf')}</p>
                <p className="font-medium">{d.modelName}</p>
                <p className="text-xs text-muted">
                  {[d.colorName, d.sizeName].filter(Boolean).join(' / ')} · {t('item.variantHint')}
                </p>
                <Link
                  className="mt-1 inline-block text-xs font-medium text-brand hover:underline"
                  to={`/inventory/models/${d.modelId}`}
                >
                  {t('item.openModel')}
                </Link>
              </div>
            ) : (
              <NameFields
                values={names}
                onChange={setNames}
                label={t('item.name')}
                placeholder={isNew ? t('item.namePlaceholder') : undefined}
                autoFocus={isNew}
              />
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('item.sku')}</span>
                <input
                  className={`${field} uppercase placeholder:normal-case`}
                  dir="ltr"
                  placeholder={t('item.auto')}
                  value={sku}
                  disabled={!canFields}
                  onChange={(e) => setSku(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-xs text-muted">{t('item.category')}</span>
                <select
                  className={field}
                  value={categoryId}
                  disabled={!canFields || isVariant}
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
                  disabled={!canFields}
                  onChange={(e) => setReorder(e.target.value)}
                />
              </label>
            </div>
            <SupplierFields
              supplierId={supplierId}
              supplierCode={supplierCode}
              currentName={d?.supplierName}
              onSupplier={setSupplierId}
              onCode={setSupplierCode}
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
              levels={levels.data ?? []}
              inputs={prices}
              onChange={setPricesInput}
              saved={d?.prices}
              currency={currency}
              readOnly={!canPrices}
            />
          </Card>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:h-fit">
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
              {pending ? t('item.saving') : t('item.save')}
            </Button>
            {d && canFields && (
              <>
                <Button
                  className="w-full"
                  variant={d.isActive ? 'ghost' : 'secondary'}
                  disabled={pending || (d.isActive && d.stockOnHand !== 0)}
                  onClick={() => setActive(!d.isActive)}
                >
                  {d.isActive ? t('item.close') : t('item.reopen')}
                </Button>
                {d.isActive && (
                  <p className="text-center text-xs text-faint">{t('item.closeHint')}</p>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
