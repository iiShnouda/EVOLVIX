using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class InvoiceChangesNumberingCashCustomers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DefaultCarrierId",
                table: "Parties",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsCashCustomer",
                table: "Parties",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RequireDepartment",
                table: "CompanySettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "DocumentNumberings",
                columns: table => new
                {
                    Type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Prefix = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StartAt = table.Column<int>(type: "integer", nullable: false),
                    Digits = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentNumberings", x => x.Type);
                });

            // Owner decision 2026-10-01: changing and cancelling posted invoices, pricing at the
            // last price or at cost, changing a customer's shipping and marking cash customers go
            // to whoever approves sales (the accountant and up). Changing a posted invoice
            // (sales:edit, which did nothing before) stays only with them.
            migrationBuilder.Sql("""
                UPDATE "RolePermissionSets" SET "Permissions" = array(
                  SELECT DISTINCT unnest("Permissions" || ARRAY['sales:edit','sales:cancel','sales:price_basis','sales:change_shipping','parties:cash_customer']))
                WHERE 'sales:approve' = ANY("Permissions");
                UPDATE "RolePermissionSets" SET "Permissions" = array_remove("Permissions", 'sales:edit')
                WHERE NOT 'sales:approve' = ANY("Permissions");
                UPDATE "Staff" SET "GrantedPermissions" = array(
                  SELECT DISTINCT unnest("GrantedPermissions" || ARRAY['sales:edit','sales:cancel','sales:price_basis','sales:change_shipping','parties:cash_customer']))
                WHERE 'sales:approve' = ANY("GrantedPermissions");
                UPDATE "Staff" SET "GrantedPermissions" = array_remove("GrantedPermissions", 'sales:edit')
                WHERE NOT 'sales:approve' = ANY("GrantedPermissions");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DocumentNumberings");

            migrationBuilder.DropColumn(
                name: "DefaultCarrierId",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "IsCashCustomer",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "RequireDepartment",
                table: "CompanySettings");
        }
    }
}
