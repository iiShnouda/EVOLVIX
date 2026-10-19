using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PartyContactPermission : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Contact details get their own permission (owner, 2026-10-19): whoever could see
            // parties keeps seeing them, until the owner takes it away.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'parties:contact')
WHERE 'parties:view' = ANY(""Permissions"") AND NOT 'parties:contact' = ANY(""Permissions"");
UPDATE ""CustomRoles"" SET ""Permissions"" = array_append(""Permissions"", 'parties:contact')
WHERE 'parties:view' = ANY(""Permissions"") AND NOT 'parties:contact' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'parties:contact')
WHERE 'parties:view' = ANY(""GrantedPermissions"") AND NOT 'parties:contact' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'parties:contact')
WHERE 'parties:view' = ANY(""RevokedPermissions"") AND NOT 'parties:contact' = ANY(""RevokedPermissions"");
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
