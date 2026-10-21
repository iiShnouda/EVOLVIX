using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PriceListScopeSetupDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "MinAmount",
                table: "QuantityBreaks",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentId",
                table: "PriceLists",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "GroupId",
                table: "PriceLists",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "MinAmount",
                table: "PriceLists",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "PercentBp",
                table: "PriceLists",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Deleting units, sizes, colors, seasons and sub-groups (owner, 2026-10-21) goes to whoever
            // may delete departments.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'setup:delete')
WHERE 'departments:delete' = ANY(""Permissions"") AND NOT 'setup:delete' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'setup:delete')
WHERE 'departments:delete' = ANY(""Permissions"") AND NOT 'setup:delete' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'setup:delete')
WHERE 'departments:delete' = ANY(""GrantedPermissions"") AND NOT 'setup:delete' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'setup:delete')
WHERE 'departments:delete' = ANY(""RevokedPermissions"") AND NOT 'setup:delete' = ANY(""RevokedPermissions"");
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MinAmount",
                table: "QuantityBreaks");

            migrationBuilder.DropColumn(
                name: "DepartmentId",
                table: "PriceLists");

            migrationBuilder.DropColumn(
                name: "GroupId",
                table: "PriceLists");

            migrationBuilder.DropColumn(
                name: "MinAmount",
                table: "PriceLists");

            migrationBuilder.DropColumn(
                name: "PercentBp",
                table: "PriceLists");
        }
    }
}
