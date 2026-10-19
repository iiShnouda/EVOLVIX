using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class ValuationPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The valuation, its parts and columns get their own permissions (owner, 2026-10-19):
            // whoever could see it (costs:view) keeps seeing it, until the owner takes it away.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:valuation')
WHERE 'costs:view' = ANY(""GrantedPermissions"") AND NOT 'inventory:valuation' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:valuation')
WHERE 'costs:view' = ANY(""RevokedPermissions"") AND NOT 'inventory:valuation' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation_departments')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation_departments' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation_departments')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation_departments' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:valuation_departments')
WHERE 'costs:view' = ANY(""GrantedPermissions"") AND NOT 'inventory:valuation_departments' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:valuation_departments')
WHERE 'costs:view' = ANY(""RevokedPermissions"") AND NOT 'inventory:valuation_departments' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation_warehouses')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation_warehouses' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation_warehouses')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation_warehouses' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:valuation_warehouses')
WHERE 'costs:view' = ANY(""GrantedPermissions"") AND NOT 'inventory:valuation_warehouses' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:valuation_warehouses')
WHERE 'costs:view' = ANY(""RevokedPermissions"") AND NOT 'inventory:valuation_warehouses' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation_items')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation_items' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:valuation_items')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'inventory:valuation_items' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:valuation_items')
WHERE 'costs:view' = ANY(""GrantedPermissions"") AND NOT 'inventory:valuation_items' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:valuation_items')
WHERE 'costs:view' = ANY(""RevokedPermissions"") AND NOT 'inventory:valuation_items' = ANY(""RevokedPermissions"");
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
