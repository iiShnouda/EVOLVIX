using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class BranchCost : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StockCosts",
                columns: table => new
                {
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    PoolId = table.Column<Guid>(type: "uuid", nullable: false),
                    AvgCost = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockCosts", x => new { x.ProductId, x.PoolId });
                    table.ForeignKey(
                        name: "FK_StockCosts_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Existing databases: cost becomes per branch (owner decision 2026-09-29). Every branch
            // holding an item starts at today's company average for it; goods already in transit
            // keep the exact cost of the permits that sent them.
            migrationBuilder.Sql("""
                INSERT INTO "StockCosts" ("ProductId", "PoolId", "AvgCost", "UpdatedAt")
                SELECT DISTINCT b."ProductId", w."BranchId", p."CostPrice", now()
                FROM "StockBalances" b
                JOIN "Warehouses" w ON w."Id" = b."WarehouseId" AND w."Kind" = 'STORE'
                JOIN "Products" p ON p."Id" = b."ProductId"
                WHERE b."Quantity" <> 0;

                INSERT INTO "StockCosts" ("ProductId", "PoolId", "AvgCost", "UpdatedAt")
                SELECT l."ProductId", w."Id",
                       ROUND(SUM(l."Quantity"::numeric * l."UnitCost") / SUM(l."Quantity"))::bigint, now()
                FROM "StockTransferLines" l
                JOIN "StockTransfers" t ON t."Id" = l."TransferId" AND t."Status" = 'SENT'
                CROSS JOIN (SELECT "Id" FROM "Warehouses" WHERE "Kind" = 'TRANSIT' LIMIT 1) w
                GROUP BY l."ProductId", w."Id";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StockCosts");
        }
    }
}
