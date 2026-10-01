using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class CustomRolesFinerPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CustomRoleId",
                table: "Staff",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CustomRoles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    BaseRole = table.Column<string>(type: "text", nullable: false),
                    Permissions = table.Column<List<string>>(type: "text[]", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomRoles", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Staff_CustomRoleId",
                table: "Staff",
                column: "CustomRoleId");

            migrationBuilder.CreateIndex(
                name: "IX_CustomRoles_Name",
                table: "CustomRoles",
                column: "Name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Staff_CustomRoles_CustomRoleId",
                table: "Staff",
                column: "CustomRoleId",
                principalTable: "CustomRoles",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // The finer permissions start where the one they came out of was (owner decision 2026-10-01).
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:stocktake')
WHERE 'inventory:edit' = ANY(""Permissions"") AND NOT 'inventory:stocktake' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:stocktake')
WHERE 'inventory:edit' = ANY(""GrantedPermissions"") AND NOT 'inventory:stocktake' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:stocktake')
WHERE 'inventory:edit' = ANY(""RevokedPermissions"") AND NOT 'inventory:stocktake' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'inventory:transfer')
WHERE 'inventory:edit' = ANY(""Permissions"") AND NOT 'inventory:transfer' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'inventory:transfer')
WHERE 'inventory:edit' = ANY(""GrantedPermissions"") AND NOT 'inventory:transfer' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'inventory:transfer')
WHERE 'inventory:edit' = ANY(""RevokedPermissions"") AND NOT 'inventory:transfer' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'products:close')
WHERE 'products:edit' = ANY(""Permissions"") AND NOT 'products:close' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'products:close')
WHERE 'products:edit' = ANY(""GrantedPermissions"") AND NOT 'products:close' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'products:close')
WHERE 'products:edit' = ANY(""RevokedPermissions"") AND NOT 'products:close' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'parties:close')
WHERE 'parties:edit' = ANY(""Permissions"") AND NOT 'parties:close' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'parties:close')
WHERE 'parties:edit' = ANY(""GrantedPermissions"") AND NOT 'parties:close' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'parties:close')
WHERE 'parties:edit' = ANY(""RevokedPermissions"") AND NOT 'parties:close' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'sales:return_free')
WHERE 'sales:return' = ANY(""Permissions"") AND NOT 'sales:return_free' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'sales:return_free')
WHERE 'sales:return' = ANY(""GrantedPermissions"") AND NOT 'sales:return_free' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'sales:return_free')
WHERE 'sales:return' = ANY(""RevokedPermissions"") AND NOT 'sales:return_free' = ANY(""RevokedPermissions"");
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'purchases:return_free')
WHERE 'purchases:return' = ANY(""Permissions"") AND NOT 'purchases:return_free' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'purchases:return_free')
WHERE 'purchases:return' = ANY(""GrantedPermissions"") AND NOT 'purchases:return_free' = ANY(""GrantedPermissions"");
UPDATE ""Staff"" SET ""RevokedPermissions"" = array_append(""RevokedPermissions"", 'purchases:return_free')
WHERE 'purchases:return' = ANY(""RevokedPermissions"") AND NOT 'purchases:return_free' = ANY(""RevokedPermissions"");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Staff_CustomRoles_CustomRoleId",
                table: "Staff");

            migrationBuilder.DropTable(
                name: "CustomRoles");

            migrationBuilder.DropIndex(
                name: "IX_Staff_CustomRoleId",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "CustomRoleId",
                table: "Staff");
        }
    }
}
