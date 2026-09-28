using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class Warehouses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "WarehouseBalanceAfter",
                table: "StockMovements",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "WarehouseId",
                table: "StockMovements",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "WarehouseId",
                table: "DocumentLines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Warehouses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Warehouses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Warehouses_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StockBalances",
                columns: table => new
                {
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockBalances", x => new { x.ProductId, x.WarehouseId });
                    table.ForeignKey(
                        name: "FK_StockBalances_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StockBalances_Warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "Warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_WarehouseId_ProductId_CreatedAt",
                table: "StockMovements",
                columns: new[] { "WarehouseId", "ProductId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DocumentLines_WarehouseId",
                table: "DocumentLines",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_StockBalances_WarehouseId",
                table: "StockBalances",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_Warehouses_BranchId",
                table: "Warehouses",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_Warehouses_Code",
                table: "Warehouses",
                column: "Code",
                unique: true);

            // Existing databases: give every branch a default warehouse, and put all current stock
            // (the ledger was company-wide until now) in the oldest branch's warehouse. Movements,
            // per-warehouse running balances, balances and invoice lines all point there, so
            // StockOnHand = Σ balances = Σ movements still holds. No-op on a fresh database.
            migrationBuilder.Sql("""
                INSERT INTO "Warehouses" ("Id", "Name", "Code", "BranchId", "IsDefault", "IsActive", "CreatedAt")
                SELECT gen_random_uuid(), b."Name" || ' store', upper(b."Code") || '-1', b."Id", TRUE, TRUE, now()
                FROM "Branches" b;

                UPDATE "StockMovements" m
                SET "WarehouseId" = h."Id", "BranchId" = h."BranchId"
                FROM (SELECT w."Id", w."BranchId" FROM "Warehouses" w
                      JOIN "Branches" b ON b."Id" = w."BranchId"
                      ORDER BY b."CreatedAt", b."Id" LIMIT 1) h;

                UPDATE "StockMovements" m
                SET "WarehouseBalanceAfter" = r.balance
                FROM (SELECT "Id", SUM("Quantity") OVER (
                          PARTITION BY "ProductId", "WarehouseId" ORDER BY "CreatedAt", "Id") AS balance
                      FROM "StockMovements") r
                WHERE r."Id" = m."Id";

                INSERT INTO "StockBalances" ("ProductId", "WarehouseId", "Quantity", "UpdatedAt")
                SELECT p."Id", h."Id", p."StockOnHand", now()
                FROM "Products" p
                CROSS JOIN (SELECT w."Id" FROM "Warehouses" w
                            JOIN "Branches" b ON b."Id" = w."BranchId"
                            ORDER BY b."CreatedAt", b."Id" LIMIT 1) h
                WHERE p."StockOnHand" <> 0;

                UPDATE "DocumentLines" l
                SET "WarehouseId" = h."Id"
                FROM (SELECT w."Id" FROM "Warehouses" w
                      JOIN "Branches" b ON b."Id" = w."BranchId"
                      ORDER BY b."CreatedAt", b."Id" LIMIT 1) h
                WHERE l."WarehouseId" IS NULL;
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_DocumentLines_Warehouses_WarehouseId",
                table: "DocumentLines",
                column: "WarehouseId",
                principalTable: "Warehouses",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_StockMovements_Warehouses_WarehouseId",
                table: "StockMovements",
                column: "WarehouseId",
                principalTable: "Warehouses",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DocumentLines_Warehouses_WarehouseId",
                table: "DocumentLines");

            migrationBuilder.DropForeignKey(
                name: "FK_StockMovements_Warehouses_WarehouseId",
                table: "StockMovements");

            migrationBuilder.DropTable(
                name: "StockBalances");

            migrationBuilder.DropTable(
                name: "Warehouses");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_WarehouseId_ProductId_CreatedAt",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_DocumentLines_WarehouseId",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "WarehouseBalanceAfter",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "WarehouseId",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "WarehouseId",
                table: "DocumentLines");
        }
    }
}
