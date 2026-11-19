using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class NotificationPlacesPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "BranchId",
                table: "Notifications",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentId",
                table: "Notifications",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "WarehouseId",
                table: "Notifications",
                type: "uuid",
                nullable: true);

            // Each kind of notification has its own permission (owner, 2026-11-18): whoever was told
            // of a kind through the action's permission (approving, receiving cash or goods, payroll,
            // the journal, backups, invoice alerts) keeps being told, through the new one.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:invoice_edited')
WHERE 'sales:invoice_alerts' = ANY(""Permissions"") AND NOT 'notifications:invoice_edited' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:invoice_edited')
WHERE 'sales:invoice_alerts' = ANY(""Permissions"") AND NOT 'notifications:invoice_edited' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:invoice_edited')
WHERE 'sales:invoice_alerts' = ANY(""GrantedPermissions"") AND NOT 'notifications:invoice_edited' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:invoice_edited')
WHERE 'sales:invoice_alerts' = ANY(""RevokedPermissions"") AND NOT 'notifications:invoice_edited' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:order_pending')
WHERE 'sales:approve' = ANY(""Permissions"") AND NOT 'notifications:order_pending' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:order_pending')
WHERE 'sales:approve' = ANY(""Permissions"") AND NOT 'notifications:order_pending' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:order_pending')
WHERE 'sales:approve' = ANY(""GrantedPermissions"") AND NOT 'notifications:order_pending' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:order_pending')
WHERE 'sales:approve' = ANY(""RevokedPermissions"") AND NOT 'notifications:order_pending' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:limit_wait')
WHERE 'sales:approve' = ANY(""Permissions"") AND NOT 'notifications:limit_wait' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:limit_wait')
WHERE 'sales:approve' = ANY(""Permissions"") AND NOT 'notifications:limit_wait' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:limit_wait')
WHERE 'sales:approve' = ANY(""GrantedPermissions"") AND NOT 'notifications:limit_wait' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:limit_wait')
WHERE 'sales:approve' = ANY(""RevokedPermissions"") AND NOT 'notifications:limit_wait' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:cash_sent')
WHERE 'cash:handover_receive' = ANY(""Permissions"") AND NOT 'notifications:cash_sent' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:cash_sent')
WHERE 'cash:handover_receive' = ANY(""Permissions"") AND NOT 'notifications:cash_sent' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:cash_sent')
WHERE 'cash:handover_receive' = ANY(""GrantedPermissions"") AND NOT 'notifications:cash_sent' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:cash_sent')
WHERE 'cash:handover_receive' = ANY(""RevokedPermissions"") AND NOT 'notifications:cash_sent' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:transfer_sent')
WHERE 'inventory:transfer_receive' = ANY(""Permissions"") AND NOT 'notifications:transfer_sent' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:transfer_sent')
WHERE 'inventory:transfer_receive' = ANY(""Permissions"") AND NOT 'notifications:transfer_sent' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:transfer_sent')
WHERE 'inventory:transfer_receive' = ANY(""GrantedPermissions"") AND NOT 'notifications:transfer_sent' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:transfer_sent')
WHERE 'inventory:transfer_receive' = ANY(""RevokedPermissions"") AND NOT 'notifications:transfer_sent' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:payroll')
WHERE 'payroll:runs' = ANY(""Permissions"") AND NOT 'notifications:payroll' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:payroll')
WHERE 'payroll:runs' = ANY(""Permissions"") AND NOT 'notifications:payroll' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:payroll')
WHERE 'payroll:runs' = ANY(""GrantedPermissions"") AND NOT 'notifications:payroll' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:payroll')
WHERE 'payroll:runs' = ANY(""RevokedPermissions"") AND NOT 'notifications:payroll' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:books')
WHERE 'ledger:journal' = ANY(""Permissions"") AND NOT 'notifications:books' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:books')
WHERE 'ledger:journal' = ANY(""Permissions"") AND NOT 'notifications:books' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:books')
WHERE 'ledger:journal' = ANY(""GrantedPermissions"") AND NOT 'notifications:books' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:books')
WHERE 'ledger:journal' = ANY(""RevokedPermissions"") AND NOT 'notifications:books' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:backup')
WHERE 'backup:create' = ANY(""Permissions"") AND NOT 'notifications:backup' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'notifications:backup')
WHERE 'backup:create' = ANY(""Permissions"") AND NOT 'notifications:backup' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'notifications:backup')
WHERE 'backup:create' = ANY(""GrantedPermissions"") AND NOT 'notifications:backup' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'notifications:backup')
WHERE 'backup:create' = ANY(""RevokedPermissions"") AND NOT 'notifications:backup' = ANY(""RevokedPermissions"");
");

            // Where the ones already sent happened, where the document still says it.
            migrationBuilder.Sql(@"
UPDATE ""Notifications"" n SET ""BranchId"" = d.""BranchId"", ""DepartmentId"" = d.""DepartmentId""
FROM ""SalesDocuments"" d
WHERE n.""DocumentId"" = d.""Id"" AND n.""BranchId"" IS NULL
  AND n.""Kind"" IN ('INVOICE_NEW','INVOICE_EDITED','ORDER_PENDING','LIMIT_WAIT','ORDER_APPROVED','ORDER_REJECTED','RETURN_MADE');
UPDATE ""Notifications"" n SET ""BranchId"" = x.""BranchId""
FROM ""Notes"" x
WHERE n.""DocumentId"" = x.""Id"" AND n.""BranchId"" IS NULL AND n.""Kind"" IN ('NOTE_DUE','NOTE_OVERDUE','NOTE_BOUNCED');
UPDATE ""Notifications"" n SET ""BranchId"" = w.""BranchId"", ""WarehouseId"" = w.""Id""
FROM ""StockTransfers"" t JOIN ""Warehouses"" w ON w.""Id"" = t.""ToWarehouseId""
WHERE n.""DocumentId"" = t.""Id"" AND n.""BranchId"" IS NULL AND n.""Kind"" = 'TRANSFER_SENT';
UPDATE ""Notifications"" n SET ""BranchId"" = w.""BranchId"", ""WarehouseId"" = w.""Id""
FROM ""StockTransfers"" t JOIN ""Warehouses"" w ON w.""Id"" = t.""FromWarehouseId""
WHERE n.""DocumentId"" = t.""Id"" AND n.""BranchId"" IS NULL AND n.""Kind"" IN ('TRANSFER_RECEIVED','TRANSFER_CANCELLED');
UPDATE ""Notifications"" n SET ""BranchId"" = a.""BranchId"", ""WarehouseId"" = a.""WarehouseId""
FROM ""CashHandovers"" h JOIN ""MoneyAccounts"" a ON a.""Id"" = h.""ToAccountId""
WHERE n.""DocumentId"" = h.""Id"" AND n.""BranchId"" IS NULL AND n.""Kind"" = 'CASH_SENT';
UPDATE ""Notifications"" n SET ""BranchId"" = a.""BranchId"", ""WarehouseId"" = a.""WarehouseId""
FROM ""CashHandovers"" h JOIN ""MoneyAccounts"" a ON a.""Id"" = h.""FromAccountId""
WHERE n.""DocumentId"" = h.""Id"" AND n.""BranchId"" IS NULL AND n.""Kind"" IN ('CASH_RECEIVED','CASH_CANCELLED');
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BranchId",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "DepartmentId",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "WarehouseId",
                table: "Notifications");
        }
    }
}
