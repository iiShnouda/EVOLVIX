using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class InvoiceAdjustments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "DiscountFixed",
                table: "DocumentLines",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DiscountRateBp",
                table: "DocumentLines",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "DocIncrease",
                table: "DocumentLines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Increase",
                table: "DocumentLines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "IncreaseFixed",
                table: "DocumentLines",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "IncreaseRateBp",
                table: "DocumentLines",
                type: "integer",
                nullable: true);

            // A discount or an increase, on an item or the whole invoice, as a percent or an amount: each
            // its own permission (owner, 2026-11-19). Whoever had the invoice discount or the item
            // discount has both of its halves; whoever could raise a price on an invoice may increase an
            // item; whoever could change a price may increase the whole invoice. In roles, custom roles
            // and per-person grants and refusals alike.
            foreach (var (from, to) in new[]
                     {
                         ("sales:discount", "sales:discount_pct"), ("sales:discount", "sales:discount_amount"),
                         ("sales:discount_line", "sales:discount_line_pct"),
                         ("sales:discount_line", "sales:discount_line_amount"),
                         ("sales:raise_price", "sales:increase_line_pct"),
                         ("sales:raise_price", "sales:increase_line_amount"),
                         ("sales:change_price", "sales:increase_pct"), ("sales:change_price", "sales:increase_amount"),
                     })
                foreach (var (table, column) in new[]
                         {
                             ("RolePermissionSets", "Permissions"), ("CustomRoles", "Permissions"),
                             ("Staff", "GrantedPermissions"), ("Staff", "RevokedPermissions"),
                         })
                    migrationBuilder.Sql($@"
UPDATE ""{table}"" SET ""{column}"" = array_append(""{column}"", '{to}')
WHERE '{from}' = ANY(""{column}"") AND NOT '{to}' = ANY(""{column}"");");
            foreach (var gone in new[] { "sales:discount", "sales:discount_line" })
                foreach (var (table, column) in new[]
                         {
                             ("RolePermissionSets", "Permissions"), ("CustomRoles", "Permissions"),
                             ("Staff", "GrantedPermissions"), ("Staff", "RevokedPermissions"),
                         })
                    migrationBuilder.Sql($@"UPDATE ""{table}"" SET ""{column}"" = array_remove(""{column}"", '{gone}') WHERE '{gone}' = ANY(""{column}"");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DiscountFixed",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "DiscountRateBp",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "DocIncrease",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "Increase",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "IncreaseFixed",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "IncreaseRateBp",
                table: "DocumentLines");
        }
    }
}
