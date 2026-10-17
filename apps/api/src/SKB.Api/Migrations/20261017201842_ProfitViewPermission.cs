using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProfitViewPermission : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Profit gets a permission of its own (owner, 2026-10-17): whoever could see costs keeps
            // seeing profit, so nothing changes until the owner takes one away.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'profit:view')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'profit:view' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'profit:view')
WHERE 'costs:view' = ANY(""Permissions"") AND NOT 'profit:view' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'profit:view')
WHERE 'costs:view' = ANY(""GrantedPermissions"") AND NOT 'profit:view' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'profit:view')
WHERE 'costs:view' = ANY(""RevokedPermissions"") AND NOT 'profit:view' = ANY(""RevokedPermissions"");
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
