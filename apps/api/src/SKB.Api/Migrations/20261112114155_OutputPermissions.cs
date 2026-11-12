using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <summary>
    /// Print, PDF and Excel as permissions of their own on every page, and the company's print
    /// layout (owner, 2026-11-12).
    /// </summary>
    public partial class OutputPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PrintLayout",
                table: "CompanySettings",
                type: "text",
                nullable: true);

            // Changing the print options becomes a permission (owner, 2026-11-12): the others print
            // with the company's layout, which starts as the owner's own print options.
            migrationBuilder.Sql(@"
UPDATE ""CompanySettings"" SET ""PrintLayout"" = (
    SELECT json_object_agg(p.""Key"", p.""Value"")::text FROM ""StaffPreferences"" p
    WHERE p.""Key"" LIKE 'columns:print.%' AND p.""StaffId"" = (
        SELECT s.""Id"" FROM ""Staff"" s WHERE s.""Role"" = 'OWNER' ORDER BY s.""CreatedAt"" LIMIT 1))
WHERE ""PrintLayout"" IS NULL;
");

            // Saving as PDF, and printing and Excel where a page had no permission for them, are
            // permissions of their own (owner, 2026-11-12). Whoever could do it before still can:
            // PDF came with printing, the payroll Excel with opening a run, the count sheet with
            // opening the stocktake, printing the activity log with seeing it. Roles, made roles,
            // and what was given to or taken from each person alike.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'sales:pdf') WHERE 'sales:print' = ANY(""Permissions"") AND NOT 'sales:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'sales:pdf') WHERE 'sales:print' = ANY(""Permissions"") AND NOT 'sales:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'sales:pdf') WHERE 'sales:print' = ANY(""GrantedPermissions"") AND NOT 'sales:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'sales:pdf') WHERE 'sales:print' = ANY(""RevokedPermissions"") AND NOT 'sales:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'purchases:pdf') WHERE 'purchases:print' = ANY(""Permissions"") AND NOT 'purchases:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'purchases:pdf') WHERE 'purchases:print' = ANY(""Permissions"") AND NOT 'purchases:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'purchases:pdf') WHERE 'purchases:print' = ANY(""GrantedPermissions"") AND NOT 'purchases:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'purchases:pdf') WHERE 'purchases:print' = ANY(""RevokedPermissions"") AND NOT 'purchases:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:pdf') WHERE 'inventory:print' = ANY(""Permissions"") AND NOT 'inventory:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:pdf') WHERE 'inventory:print' = ANY(""Permissions"") AND NOT 'inventory:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:pdf') WHERE 'inventory:print' = ANY(""GrantedPermissions"") AND NOT 'inventory:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:pdf') WHERE 'inventory:print' = ANY(""RevokedPermissions"") AND NOT 'inventory:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'transfers:pdf') WHERE 'transfers:print' = ANY(""Permissions"") AND NOT 'transfers:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'transfers:pdf') WHERE 'transfers:print' = ANY(""Permissions"") AND NOT 'transfers:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'transfers:pdf') WHERE 'transfers:print' = ANY(""GrantedPermissions"") AND NOT 'transfers:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'transfers:pdf') WHERE 'transfers:print' = ANY(""RevokedPermissions"") AND NOT 'transfers:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'labels:pdf') WHERE 'labels:print' = ANY(""Permissions"") AND NOT 'labels:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'labels:pdf') WHERE 'labels:print' = ANY(""Permissions"") AND NOT 'labels:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'labels:pdf') WHERE 'labels:print' = ANY(""GrantedPermissions"") AND NOT 'labels:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'labels:pdf') WHERE 'labels:print' = ANY(""RevokedPermissions"") AND NOT 'labels:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'parties:pdf') WHERE 'parties:print' = ANY(""Permissions"") AND NOT 'parties:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'parties:pdf') WHERE 'parties:print' = ANY(""Permissions"") AND NOT 'parties:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'parties:pdf') WHERE 'parties:print' = ANY(""GrantedPermissions"") AND NOT 'parties:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'parties:pdf') WHERE 'parties:print' = ANY(""RevokedPermissions"") AND NOT 'parties:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'statement:pdf') WHERE 'statement:print' = ANY(""Permissions"") AND NOT 'statement:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'statement:pdf') WHERE 'statement:print' = ANY(""Permissions"") AND NOT 'statement:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'statement:pdf') WHERE 'statement:print' = ANY(""GrantedPermissions"") AND NOT 'statement:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'statement:pdf') WHERE 'statement:print' = ANY(""RevokedPermissions"") AND NOT 'statement:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'money:pdf') WHERE 'money:print' = ANY(""Permissions"") AND NOT 'money:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'money:pdf') WHERE 'money:print' = ANY(""Permissions"") AND NOT 'money:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'money:pdf') WHERE 'money:print' = ANY(""GrantedPermissions"") AND NOT 'money:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'money:pdf') WHERE 'money:print' = ANY(""RevokedPermissions"") AND NOT 'money:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'ledger:pdf') WHERE 'ledger:print' = ANY(""Permissions"") AND NOT 'ledger:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'ledger:pdf') WHERE 'ledger:print' = ANY(""Permissions"") AND NOT 'ledger:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'ledger:pdf') WHERE 'ledger:print' = ANY(""GrantedPermissions"") AND NOT 'ledger:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'ledger:pdf') WHERE 'ledger:print' = ANY(""RevokedPermissions"") AND NOT 'ledger:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'payroll:pdf') WHERE 'payroll:print' = ANY(""Permissions"") AND NOT 'payroll:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'payroll:pdf') WHERE 'payroll:print' = ANY(""Permissions"") AND NOT 'payroll:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'payroll:pdf') WHERE 'payroll:print' = ANY(""GrantedPermissions"") AND NOT 'payroll:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'payroll:pdf') WHERE 'payroll:print' = ANY(""RevokedPermissions"") AND NOT 'payroll:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'reports:pdf') WHERE 'reports:print' = ANY(""Permissions"") AND NOT 'reports:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'reports:pdf') WHERE 'reports:print' = ANY(""Permissions"") AND NOT 'reports:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'reports:pdf') WHERE 'reports:print' = ANY(""GrantedPermissions"") AND NOT 'reports:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'reports:pdf') WHERE 'reports:print' = ANY(""RevokedPermissions"") AND NOT 'reports:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'payroll:export') WHERE 'payroll:runs' = ANY(""Permissions"") AND NOT 'payroll:export' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'payroll:export') WHERE 'payroll:runs' = ANY(""Permissions"") AND NOT 'payroll:export' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'payroll:export') WHERE 'payroll:runs' = ANY(""GrantedPermissions"") AND NOT 'payroll:export' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'payroll:export') WHERE 'payroll:runs' = ANY(""RevokedPermissions"") AND NOT 'payroll:export' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'stocktake:print') WHERE 'inventory:stocktake_view' = ANY(""Permissions"") AND NOT 'stocktake:print' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'stocktake:print') WHERE 'inventory:stocktake_view' = ANY(""Permissions"") AND NOT 'stocktake:print' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'stocktake:print') WHERE 'inventory:stocktake_view' = ANY(""GrantedPermissions"") AND NOT 'stocktake:print' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'stocktake:print') WHERE 'inventory:stocktake_view' = ANY(""RevokedPermissions"") AND NOT 'stocktake:print' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'stocktake:pdf') WHERE 'inventory:stocktake_view' = ANY(""Permissions"") AND NOT 'stocktake:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'stocktake:pdf') WHERE 'inventory:stocktake_view' = ANY(""Permissions"") AND NOT 'stocktake:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'stocktake:pdf') WHERE 'inventory:stocktake_view' = ANY(""GrantedPermissions"") AND NOT 'stocktake:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'stocktake:pdf') WHERE 'inventory:stocktake_view' = ANY(""RevokedPermissions"") AND NOT 'stocktake:pdf' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'audit:print') WHERE 'audit:view' = ANY(""Permissions"") AND NOT 'audit:print' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'audit:print') WHERE 'audit:view' = ANY(""Permissions"") AND NOT 'audit:print' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'audit:print') WHERE 'audit:view' = ANY(""GrantedPermissions"") AND NOT 'audit:print' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'audit:print') WHERE 'audit:view' = ANY(""RevokedPermissions"") AND NOT 'audit:print' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'audit:pdf') WHERE 'audit:view' = ANY(""Permissions"") AND NOT 'audit:pdf' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'audit:pdf') WHERE 'audit:view' = ANY(""Permissions"") AND NOT 'audit:pdf' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'audit:pdf') WHERE 'audit:view' = ANY(""GrantedPermissions"") AND NOT 'audit:pdf' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'audit:pdf') WHERE 'audit:view' = ANY(""RevokedPermissions"") AND NOT 'audit:pdf' = ANY(""RevokedPermissions"");
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PrintLayout",
                table: "CompanySettings");
        }
    }
}
