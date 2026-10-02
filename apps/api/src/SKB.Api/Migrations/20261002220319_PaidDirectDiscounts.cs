using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PaidDirectDiscounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_PartyId",
                table: "SalesDocuments");

            migrationBuilder.AddColumn<long>(
                name: "PaidDirect",
                table: "SalesDocuments",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_PartyId_Type_IssueDate",
                table: "SalesDocuments",
                columns: new[] { "PartyId", "Type", "IssueDate" });

            // What existing invoices had paid outside the account: paid now when written (its money
            // movement, less a cancelled one) and cash on delivery a shipping company collected.
            migrationBuilder.Sql("""
                UPDATE "SalesDocuments" d SET "PaidDirect" = GREATEST(0, LEAST(d."GrandTotal", d."PaidAmount",
                    COALESCE((SELECT CASE WHEN d."Type" = 'PURCHASE_INVOICE' THEN -SUM(m."Amount") ELSE SUM(m."Amount") END
                              FROM "MoneyMovements" m
                              WHERE m."DocumentId" = d."Id" AND m."VoucherId" IS NULL
                                AND m."Kind" IN ('SALE_PAID', 'PURCHASE_PAID', 'CANCELLATION')), 0)
                    + COALESCE((SELECT SUM(si."CodShare") FROM "ShipmentInvoices" si
                                JOIN "Shipments" s ON s."Id" = si."ShipmentId"
                                WHERE si."DocumentId" = d."Id" AND s."Status" IN ('DELIVERED', 'SETTLED')), 0)))
                WHERE d."Type" IN ('SALES_INVOICE', 'PURCHASE_INVOICE');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_PartyId_Type_IssueDate",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "PaidDirect",
                table: "SalesDocuments");

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_PartyId",
                table: "SalesDocuments",
                column: "PartyId");
        }
    }
}
