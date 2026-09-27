import type { Prisma } from '@prisma/client';
import type { DocumentLine, SalesDocument, SalesDocumentSummary } from '@skb/shared';

export type DocumentWithRelations = Prisma.SalesDocumentGetPayload<{
  include: { branch: true; party: true; staff: true };
}>;

export type DocumentWithLines = Prisma.SalesDocumentGetPayload<{
  include: { branch: true; party: true; staff: true; lines: true };
}>;

export function toSummary(doc: DocumentWithRelations): SalesDocumentSummary {
  return {
    id: doc.id,
    number: doc.number,
    type: doc.type,
    status: doc.status,
    branchName: doc.branch.name,
    partyName: doc.party.name,
    staffName: doc.staff.fullName,
    issueDate: doc.issueDate.toISOString(),
    dueDate: doc.dueDate?.toISOString(),
    grandTotal: doc.grandTotal,
    paidAmount: doc.paidAmount,
    currency: doc.currency,
  };
}

export function toDetail(doc: DocumentWithLines): SalesDocument {
  const lines: DocumentLine[] = doc.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    productName: l.productName,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount,
    lineTotal: l.lineTotal,
  }));
  return {
    id: doc.id,
    number: doc.number,
    type: doc.type,
    status: doc.status,
    branchId: doc.branchId,
    branchName: doc.branch.name,
    partyId: doc.partyId,
    partyName: doc.party.name,
    staffId: doc.staffId,
    staffName: doc.staff.fullName,
    issueDate: doc.issueDate.toISOString(),
    dueDate: doc.dueDate?.toISOString(),
    lines,
    subtotal: doc.subtotal,
    discountTotal: doc.discountTotal,
    taxTotal: doc.taxTotal,
    grandTotal: doc.grandTotal,
    paidAmount: doc.paidAmount,
    currency: doc.currency,
    notes: doc.notes ?? undefined,
    createdAt: doc.createdAt.toISOString(),
  };
}
