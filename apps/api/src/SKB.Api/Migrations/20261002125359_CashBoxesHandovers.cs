using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class CashBoxesHandovers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "Held",
                table: "MoneyAccounts",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<bool>(
                name: "IsMain",
                table: "MoneyAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "WarehouseId",
                table: "MoneyAccounts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CashHandovers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "text", nullable: false),
                    FromAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    ToAccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    SentById = table.Column<Guid>(type: "uuid", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DoneById = table.Column<Guid>(type: "uuid", nullable: true),
                    DoneAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    VoucherId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashHandovers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CashHandovers_MoneyAccounts_FromAccountId",
                        column: x => x.FromAccountId,
                        principalTable: "MoneyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CashHandovers_MoneyAccounts_ToAccountId",
                        column: x => x.ToAccountId,
                        principalTable: "MoneyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CashHandovers_Staff_DoneById",
                        column: x => x.DoneById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CashHandovers_Staff_SentById",
                        column: x => x.SentById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CashHandovers_Vouchers_VoucherId",
                        column: x => x.VoucherId,
                        principalTable: "Vouchers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MoneyAccounts_IsMain",
                table: "MoneyAccounts",
                column: "IsMain",
                unique: true,
                filter: "\"IsMain\"");

            migrationBuilder.CreateIndex(
                name: "IX_MoneyAccounts_WarehouseId",
                table: "MoneyAccounts",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_CashHandovers_DoneById",
                table: "CashHandovers",
                column: "DoneById");

            migrationBuilder.CreateIndex(
                name: "IX_CashHandovers_FromAccountId",
                table: "CashHandovers",
                column: "FromAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_CashHandovers_Number",
                table: "CashHandovers",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CashHandovers_SentById",
                table: "CashHandovers",
                column: "SentById");

            migrationBuilder.CreateIndex(
                name: "IX_CashHandovers_Status_ToAccountId",
                table: "CashHandovers",
                columns: new[] { "Status", "ToAccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_CashHandovers_ToAccountId",
                table: "CashHandovers",
                column: "ToAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_CashHandovers_VoucherId",
                table: "CashHandovers",
                column: "VoucherId");

            migrationBuilder.AddForeignKey(
                name: "FK_MoneyAccounts_Warehouses_WarehouseId",
                table: "MoneyAccounts",
                column: "WarehouseId",
                principalTable: "Warehouses",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // The first branch's cash box is the main one until the owner picks another.
            migrationBuilder.Sql("""
                UPDATE "MoneyAccounts" SET "IsMain" = TRUE WHERE "Id" = (
                    SELECT a."Id" FROM "MoneyAccounts" a JOIN "Branches" b ON b."Id" = a."BranchId"
                    WHERE a."IsDefault" AND a."IsActive" AND a."Kind" = 'CASH_BOX'
                    ORDER BY b."CreatedAt" LIMIT 1);
                """);
            // Each store gets its own cash box, named after it.
            migrationBuilder.Sql("""
                INSERT INTO "MoneyAccounts" ("Id", "Name", "Kind", "BranchId", "Balance", "LastSeq", "Currency",
                    "IsDefault", "IsActive", "CreatedAt", "IsMain", "WarehouseId", "Held")
                SELECT gen_random_uuid(),
                    CASE WHEN EXISTS (SELECT 1 FROM "MoneyAccounts" m WHERE m."BranchId" = w."BranchId"
                                      AND m."IsActive" AND lower(m."Name") = lower(w."Name"))
                         THEN w."Name" || ' (' || w."Code" || ')' ELSE w."Name" END,
                    'CASH_BOX', w."BranchId", 0, 0,
                    COALESCE((SELECT s."Currency" FROM "CompanySettings" s LIMIT 1), 'EGP'),
                    FALSE, TRUE, now(), FALSE, w."Id", 0
                FROM "Warehouses" w WHERE w."Kind" = 'STORE' AND w."IsActive";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MoneyAccounts_Warehouses_WarehouseId",
                table: "MoneyAccounts");

            migrationBuilder.DropTable(
                name: "CashHandovers");

            migrationBuilder.DropIndex(
                name: "IX_MoneyAccounts_IsMain",
                table: "MoneyAccounts");

            migrationBuilder.DropIndex(
                name: "IX_MoneyAccounts_WarehouseId",
                table: "MoneyAccounts");

            migrationBuilder.DropColumn(
                name: "Held",
                table: "MoneyAccounts");

            migrationBuilder.DropColumn(
                name: "IsMain",
                table: "MoneyAccounts");

            migrationBuilder.DropColumn(
                name: "WarehouseId",
                table: "MoneyAccounts");
        }
    }
}
