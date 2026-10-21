using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class InventoryTotalsPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The inventory's totals get their own permissions (owner, 2026-10-21): whoever saw the item
            // count keeps the count and pieces, whoever saw the value keeps it at cost.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:total_items')
WHERE 'inventory:view' = ANY(""Permissions"") AND NOT 'inventory:total_items' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:total_items')
WHERE 'inventory:view' = ANY(""Permissions"") AND NOT 'inventory:total_items' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:total_items')
WHERE 'inventory:view' = ANY(""GrantedPermissions"") AND NOT 'inventory:total_items' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:total_items')
WHERE 'inventory:view' = ANY(""RevokedPermissions"") AND NOT 'inventory:total_items' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:total_quantity')
WHERE 'inventory:view' = ANY(""Permissions"") AND NOT 'inventory:total_quantity' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:total_quantity')
WHERE 'inventory:view' = ANY(""Permissions"") AND NOT 'inventory:total_quantity' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:total_quantity')
WHERE 'inventory:view' = ANY(""GrantedPermissions"") AND NOT 'inventory:total_quantity' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:total_quantity')
WHERE 'inventory:view' = ANY(""RevokedPermissions"") AND NOT 'inventory:total_quantity' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:total_supply_value')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:total_supply_value' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:total_supply_value')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:total_supply_value' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:total_supply_value')
WHERE 'costs:view' = ANY(""GrantedPermissions"") AND NOT 'inventory:total_supply_value' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:total_supply_value')
WHERE 'costs:view' = ANY(""RevokedPermissions"") AND NOT 'inventory:total_supply_value' = ANY(""RevokedPermissions"");
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
