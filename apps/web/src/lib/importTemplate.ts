import type { Translate } from '@skb/shared';
import { buildWorkbook, type Cell, type Sheet } from './xlsx';

/**
 * Build the data-import workbook on the device (owner, 2026-10-14): three tabs — items, customers,
 * suppliers — with headers in the screen's language (the server matches either language). An empty
 * template to fill, or one filled with sample clothing-wholesale rows so the owner can see the shape
 * and try the import at once. Nothing here touches the server; it's a plain .xlsx the owner uploads.
 */
export function buildImportWorkbook(t: Translate, demo: boolean): Uint8Array {
  const rtl = t('import.col.name') !== 'Name'; // Arabic headers → right-to-left sheets.
  const sheet = (name: string, cols: string[], rows: Cell[][]): Sheet => ({
    name,
    header: cols,
    rows: demo ? rows : [],
    rtl,
  });

  const items = sheet(
    t('import.sheet.items'),
    [
      t('import.col.name'),
      t('import.col.department'),
      t('import.col.unit'),
      t('import.col.barcode'),
      t('import.col.price'),
      t('import.col.cost'),
      t('import.col.supplier'),
      t('import.col.reorder'),
    ],
    DEMO_ITEMS,
  );
  const customers = sheet(
    t('import.sheet.customers'),
    [
      t('import.col.name'),
      t('import.col.phone'),
      t('import.col.address'),
      t('import.col.credit'),
      t('import.col.notes'),
    ],
    DEMO_CUSTOMERS,
  );
  const suppliers = sheet(
    t('import.sheet.suppliers'),
    [
      t('import.col.name'),
      t('import.col.phone'),
      t('import.col.address'),
      t('import.col.contact'),
      t('import.col.notes'),
    ],
    DEMO_SUPPLIERS,
  );
  return buildWorkbook([items, customers, suppliers]);
}

// Sample wholesale-clothing data (Arabic), so the demo file is useful on its own (task: rich demo).
// Columns: name, department, unit, barcode, sale price, cost price, supplier, reorder level.
const DEMO_ITEMS: Cell[][] = [
  ['تيشيرت رجالي قطن', 'رجالي', 'قطعة', '', 180, 110, 'مصنع الأناقة للملابس', 20],
  ['بنطلون جينز رجالي', 'رجالي', 'قطعة', '', 320, 210, 'مصنع الأناقة للملابس', 15],
  ['قميص كلاسيك رجالي', 'رجالي', 'قطعة', '', 270, 175, 'مصنع الأناقة للملابس', 12],
  ['جاكت شتوي رجالي', 'رجالي', 'قطعة', '', 540, 360, 'الشرق للتصنيع', 8],
  ['فستان سواريه حريمي', 'حريمي', 'قطعة', '', 650, 420, 'دار الموضة', 10],
  ['بلوزة حريمي', 'حريمي', 'قطعة', '', 160, 95, 'دار الموضة', 25],
  ['بنطلون حريمي قماش', 'حريمي', 'قطعة', '', 240, 150, 'دار الموضة', 18],
  ['طرحة قطن', 'حريمي', 'قطعة', '', 70, 38, 'النيل للإكسسوار', 40],
  ['تيشيرت أطفال مطبوع', 'أطفال', 'قطعة', '', 90, 52, 'بيبي لاين', 30],
  ['بيجامة أطفال قطن', 'أطفال', 'طقم', '', 130, 80, 'بيبي لاين', 22],
  ['جاكت أطفال', 'أطفال', 'قطعة', '', 210, 135, 'الشرق للتصنيع', 14],
  ['جورب قطن (دستة)', 'إكسسوار', 'دستة', '', 120, 70, 'النيل للإكسسوار', 50],
];

// Columns: name, phone, address, credit limit, notes.
const DEMO_CUSTOMERS: Cell[][] = [
  ['محل النور للملابس', '01012345678', 'شبرا - القاهرة', 20000, 'يدفع آخر الشهر'],
  ['بوتيك ملك', '01098765432', 'المنصورة', 15000, ''],
  ['محلات الإخوة', '01123456789', 'طنطا', 30000, 'عميل قديم'],
  ['سوق الجملة - محل 14', '01234567890', 'الإسكندرية', 50000, ''],
  ['محل الصفا', '01555555555', 'أسيوط', 10000, ''],
  ['تجارى المستقبل', '01066660000', 'الزقازيق', 0, 'نقدي فقط'],
];

// Columns: name, phone, address, contact, notes.
const DEMO_SUPPLIERS: Cell[][] = [
  ['مصنع الأناقة للملابس', '0223456789', 'مدينة العاشر من رمضان', 'أ. سمير', 'ملابس رجالي'],
  ['دار الموضة', '0233221144', 'مدينة السادات', 'أ. منى', 'ملابس حريمي'],
  ['بيبي لاين', '0455667788', 'المحلة الكبرى', 'أ. خالد', 'ملابس أطفال'],
  ['الشرق للتصنيع', '0501122334', 'بورسعيد', 'أ. ياسر', 'جاكتات'],
  ['النيل للإكسسوار', '0882233445', 'القاهرة - الموسكي', 'أ. هاني', 'إكسسوار'],
];
