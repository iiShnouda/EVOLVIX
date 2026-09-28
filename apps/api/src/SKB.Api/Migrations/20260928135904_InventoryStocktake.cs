using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class InventoryStocktake : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Note",
                table: "StockMovements",
                type: "text",
                nullable: true);

            // Backfill an OPENING movement wherever an item's stock isn't explained by its movements
            // (databases seeded before the movement ledger existed). After this, for every item:
            // StockOnHand = SUM(movements), so the item card and past valuations tie out.
            // Opening cost is recovered from the first movement: an issue left at the opening
            // average; a receipt's average can be backed out exactly. Otherwise use today's average.
            // Dated just before the item's first movement. No-op on a fresh database.
            migrationBuilder.Sql("""
                INSERT INTO "StockMovements"
                    ("Id", "ProductId", "BranchId", "Type", "Quantity", "UnitCost", "BalanceAfter",
                     "AvgCostAfter", "DocumentId", "Reference", "Note", "CreatedAt")
                SELECT gen_random_uuid(), p."Id", b."Id", 'OPENING',
                       p."StockOnHand" - COALESCE(s.qty, 0),
                       COALESCE(f.opening_cost, p."CostPrice"),
                       p."StockOnHand" - COALESCE(s.qty, 0),
                       COALESCE(f.opening_cost, p."CostPrice"),
                       NULL, 'Opening balance', NULL,
                       LEAST(p."CreatedAt", COALESCE(s.first_at, p."CreatedAt")) - INTERVAL '1 second'
                FROM "Products" p
                CROSS JOIN LATERAL (SELECT "Id" FROM "Branches" ORDER BY "CreatedAt" LIMIT 1) b
                LEFT JOIN (SELECT "ProductId", SUM("Quantity") AS qty, MIN("CreatedAt") AS first_at
                           FROM "StockMovements" GROUP BY "ProductId") s ON s."ProductId" = p."Id"
                LEFT JOIN LATERAL (
                    SELECT CASE
                             WHEN m."Quantity" < 0 THEN m."UnitCost"
                             WHEN m."BalanceAfter" - m."Quantity" > 0 THEN
                               ROUND((m."AvgCostAfter"::numeric * m."BalanceAfter"
                                      - m."Quantity"::numeric * m."UnitCost")
                                     / (m."BalanceAfter" - m."Quantity"))::bigint
                           END AS opening_cost
                    FROM "StockMovements" m
                    WHERE m."ProductId" = p."Id"
                    ORDER BY m."CreatedAt"
                    LIMIT 1) f ON TRUE
                WHERE p."StockOnHand" - COALESCE(s.qty, 0) <> 0;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Note",
                table: "StockMovements");
        }
    }
}
