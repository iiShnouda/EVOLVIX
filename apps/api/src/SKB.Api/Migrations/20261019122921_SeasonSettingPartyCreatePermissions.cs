using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeasonSettingPartyCreatePermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CurrentSeasonId",
                table: "CompanySettings",
                type: "uuid",
                nullable: true);

            // Adding a customer, a supplier and a shipping company each get their own permission
            // (owner, 2026-10-19): whoever could add parties can add all three, until the owner
            // takes one away.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'parties:create_customer')
WHERE 'parties:create' = ANY(""Permissions"") AND NOT 'parties:create_customer' = ANY(""Permissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'parties:create_supplier')
WHERE 'parties:create' = ANY(""Permissions"") AND NOT 'parties:create_supplier' = ANY(""Permissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'parties:create_carrier')
WHERE 'parties:create' = ANY(""Permissions"") AND NOT 'parties:create_carrier' = ANY(""Permissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_remove(""Permissions"", 'parties:create') WHERE 'parties:create' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'parties:create_customer')
WHERE 'parties:create' = ANY(""Permissions"") AND NOT 'parties:create_customer' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'parties:create_supplier')
WHERE 'parties:create' = ANY(""Permissions"") AND NOT 'parties:create_supplier' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'parties:create_carrier')
WHERE 'parties:create' = ANY(""Permissions"") AND NOT 'parties:create_carrier' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_remove(""Permissions"", 'parties:create') WHERE 'parties:create' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'parties:create_customer')
WHERE 'parties:create' = ANY(""GrantedPermissions"") AND NOT 'parties:create_customer' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'parties:create_supplier')
WHERE 'parties:create' = ANY(""GrantedPermissions"") AND NOT 'parties:create_supplier' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'parties:create_carrier')
WHERE 'parties:create' = ANY(""GrantedPermissions"") AND NOT 'parties:create_carrier' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_remove(""GrantedPermissions"", 'parties:create') WHERE 'parties:create' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'parties:create_customer')
WHERE 'parties:create' = ANY(""RevokedPermissions"") AND NOT 'parties:create_customer' = ANY(""RevokedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'parties:create_supplier')
WHERE 'parties:create' = ANY(""RevokedPermissions"") AND NOT 'parties:create_supplier' = ANY(""RevokedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'parties:create_carrier')
WHERE 'parties:create' = ANY(""RevokedPermissions"") AND NOT 'parties:create_carrier' = ANY(""RevokedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_remove(""RevokedPermissions"", 'parties:create') WHERE 'parties:create' = ANY(""RevokedPermissions"");
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CurrentSeasonId",
                table: "CompanySettings");
        }
    }
}
