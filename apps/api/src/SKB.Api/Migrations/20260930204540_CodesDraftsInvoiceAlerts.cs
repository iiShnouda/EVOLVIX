using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class CodesDraftsInvoiceAlerts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence<int>(
                name: "PartyCodes");

            migrationBuilder.CreateSequence<int>(
                name: "StaffCodes");

            migrationBuilder.AddColumn<int>(
                name: "Code",
                table: "Staff",
                type: "integer",
                nullable: false,
                defaultValueSql: "nextval('\"StaffCodes\"')");

            migrationBuilder.AddColumn<int>(
                name: "Code",
                table: "Parties",
                type: "integer",
                nullable: false,
                defaultValueSql: "nextval('\"PartyCodes\"')");

            // Those already there are numbered in the order they were added; new ones carry on.
            migrationBuilder.Sql("""
                UPDATE "Parties" p SET "Code" = n.rn FROM (
                  SELECT "Id", row_number() OVER (ORDER BY "CreatedAt", "Id") AS rn FROM "Parties") n
                WHERE p."Id" = n."Id";
                SELECT setval('"PartyCodes"', GREATEST((SELECT COALESCE(MAX("Code"), 0) FROM "Parties"), 1),
                  (SELECT COUNT(*) > 0 FROM "Parties"));
                UPDATE "Staff" s SET "Code" = n.rn FROM (
                  SELECT "Id", row_number() OVER (ORDER BY "CreatedAt", "Id") AS rn FROM "Staff") n
                WHERE s."Id" = n."Id";
                SELECT setval('"StaffCodes"', GREATEST((SELECT COALESCE(MAX("Code"), 0) FROM "Staff"), 1),
                  (SELECT COUNT(*) > 0 FROM "Staff"));
                """);

            // Invoices now post at once and the accountant is told (owner decision 2026-09-30):
            // whoever approved pending invoices hears of new ones, and whoever saved them may add to a price.
            migrationBuilder.Sql("""
                UPDATE "RolePermissionSets" SET "Permissions" = array_append("Permissions", 'sales:invoice_alerts')
                WHERE 'sales:approve' = ANY("Permissions") AND NOT 'sales:invoice_alerts' = ANY("Permissions");
                UPDATE "RolePermissionSets" SET "Permissions" = array_append("Permissions", 'sales:raise_price')
                WHERE 'sales:order' = ANY("Permissions") AND NOT 'sales:raise_price' = ANY("Permissions");
                UPDATE "Staff" SET "GrantedPermissions" = array_append("GrantedPermissions", 'sales:invoice_alerts')
                WHERE 'sales:approve' = ANY("GrantedPermissions") AND NOT 'sales:invoice_alerts' = ANY("GrantedPermissions");
                """);

            migrationBuilder.AddColumn<string>(
                name: "DepartmentName",
                table: "Notifications",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WorkDrafts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Data = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkDrafts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkDrafts_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Staff_Code",
                table: "Staff",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Parties_Code",
                table: "Parties",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkDrafts_StaffId_Key",
                table: "WorkDrafts",
                columns: new[] { "StaffId", "Key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkDrafts");

            migrationBuilder.DropIndex(
                name: "IX_Staff_Code",
                table: "Staff");

            migrationBuilder.DropIndex(
                name: "IX_Parties_Code",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "DepartmentName",
                table: "Notifications");

            migrationBuilder.DropSequence(
                name: "PartyCodes");

            migrationBuilder.DropSequence(
                name: "StaffCodes");
        }
    }
}
