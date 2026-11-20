using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <summary>
    /// A sale has one invoice discount (owner, 2026-11-20): the accountant sees it and changes it, and a
    /// discount on the combined invoices is spread into each one's. A sale's old second discount
    /// (EXTRA_DISCOUNT) joins its discount as an amount — what it came to — so no stored total, line
    /// share, balance or ledger entry moves: added to its amount discount when it has one, else it
    /// becomes that amount discount (its percent, if any, stays as it was). A purchase's second discount
    /// stays (the supplier's, not the accountant's).
    /// </summary>
    public partial class OneInvoiceDiscount : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE TEMP TABLE "_ExtraDiscounts" ON COMMIT DROP AS
                SELECT c."DocumentId", SUM(c."Amount") AS "Total", MIN(c."Seq") AS "Seq"
                FROM "DocumentCharges" c JOIN "SalesDocuments" d ON d."Id" = c."DocumentId"
                WHERE c."Kind" = 'EXTRA_DISCOUNT'
                  AND d."Type" IN ('QUOTATION', 'SALES_INVOICE', 'SALES_RETURN', 'SALES_ORDER')
                GROUP BY c."DocumentId";

                -- Into the amount discount it has, if any.
                UPDATE "DocumentCharges" c
                SET "FixedAmount" = COALESCE(c."FixedAmount", 0) + e."Total", "Amount" = c."Amount" + e."Total"
                FROM "_ExtraDiscounts" e
                WHERE e."Total" > 0 AND c."Id" = (
                    SELECT x."Id" FROM "DocumentCharges" x
                    WHERE x."DocumentId" = e."DocumentId" AND x."Kind" = 'DISCOUNT' AND x."RateBp" IS NULL
                    ORDER BY x."Seq" LIMIT 1);

                -- Those merged (and any that came to nothing) go; the rest keep one row.
                DELETE FROM "DocumentCharges" c
                USING "_ExtraDiscounts" e
                WHERE c."DocumentId" = e."DocumentId" AND c."Kind" = 'EXTRA_DISCOUNT'
                  AND (e."Total" = 0 OR c."Seq" <> e."Seq" OR EXISTS (
                      SELECT 1 FROM "DocumentCharges" x
                      WHERE x."DocumentId" = e."DocumentId" AND x."Kind" = 'DISCOUNT' AND x."RateBp" IS NULL));

                -- Else it becomes the amount discount.
                UPDATE "DocumentCharges" c
                SET "Kind" = 'DISCOUNT', "RateBp" = NULL, "FixedAmount" = e."Total", "Amount" = e."Total", "Label" = NULL
                FROM "_ExtraDiscounts" e
                WHERE c."DocumentId" = e."DocumentId" AND c."Kind" = 'EXTRA_DISCOUNT';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Nothing to undo: the totals never moved, and which part was the second discount is not kept.
        }
    }
}
