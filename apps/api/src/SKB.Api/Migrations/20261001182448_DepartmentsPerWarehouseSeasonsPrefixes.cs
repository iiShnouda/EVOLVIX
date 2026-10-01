using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class DepartmentsPerWarehouseSeasonsPrefixes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Prefix",
                table: "Warehouses",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Hex",
                table: "VariantOptions",
                type: "character varying(9)",
                maxLength: 9,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Pieces",
                table: "Units",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<Guid>(
                name: "SeasonId",
                table: "Products",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Prefix",
                table: "Departments",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Prefix",
                table: "Branches",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Seasons",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Seasons", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WarehouseDepartments",
                columns: table => new
                {
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WarehouseDepartments", x => new { x.WarehouseId, x.DepartmentId });
                    table.ForeignKey(
                        name: "FK_WarehouseDepartments_Departments_DepartmentId",
                        column: x => x.DepartmentId,
                        principalTable: "Departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WarehouseDepartments_Warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "Warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Products_SeasonId",
                table: "Products",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_Kind_Year",
                table: "Seasons",
                columns: new[] { "Kind", "Year" });

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseDepartments_DepartmentId",
                table: "WarehouseDepartments",
                column: "DepartmentId");

            migrationBuilder.AddForeignKey(
                name: "FK_Products_Seasons_SeasonId",
                table: "Products",
                column: "SeasonId",
                principalTable: "Seasons",
                principalColumn: "Id");

            // Groups become departments (owner decision 2026-10-01: "there is no group, it is a
            // department"): a group with no department joins the department of its name, made if needed.
            migrationBuilder.Sql(@"
INSERT INTO ""Departments"" (""Id"", ""Name"", ""IsActive"", ""CreatedAt"")
SELECT gen_random_uuid(), c.""Name"", true, now()
FROM (SELECT DISTINCT ""Name"" FROM ""Categories"" WHERE ""DepartmentId"" IS NULL) c
WHERE NOT EXISTS (SELECT 1 FROM ""Departments"" d WHERE lower(d.""Name"") = lower(c.""Name""));
UPDATE ""Categories"" c SET ""DepartmentId"" = (
  SELECT d.""Id"" FROM ""Departments"" d WHERE lower(d.""Name"") = lower(c.""Name"") ORDER BY d.""CreatedAt"" LIMIT 1)
WHERE c.""DepartmentId"" IS NULL;");
            // Prefixes start from the codes already there: the branch's code, the warehouse's own part.
            migrationBuilder.Sql(@"
UPDATE ""Branches"" SET ""Prefix"" = left(""Code"", 10) WHERE ""Prefix"" IS NULL;
UPDATE ""Warehouses"" SET ""Prefix"" = left(regexp_replace(""Code"", '^.*-', ''), 10)
WHERE ""Prefix"" IS NULL AND ""Kind"" <> 'TRANSIT';
UPDATE ""Units"" SET ""Pieces"" = 12 WHERE lower(""Name"") IN ('دستة', 'دسته', 'dozen');");
            // No goods "in transit" (owner decision 2026-10-01): a transfer arrives the moment it is sent.
            migrationBuilder.Sql(@"UPDATE ""CompanySettings"" SET ""TransfersRequireReceipt"" = false;");
            // Adding a season by hand goes with managing sizes and colors.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'seasons:manage')
WHERE 'variant_options:manage' = ANY(""Permissions"") AND NOT 'seasons:manage' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'seasons:manage')
WHERE 'variant_options:manage' = ANY(""GrantedPermissions"") AND NOT 'seasons:manage' = ANY(""GrantedPermissions"");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Products_Seasons_SeasonId",
                table: "Products");

            migrationBuilder.DropTable(
                name: "Seasons");

            migrationBuilder.DropTable(
                name: "WarehouseDepartments");

            migrationBuilder.DropIndex(
                name: "IX_Products_SeasonId",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "Prefix",
                table: "Warehouses");

            migrationBuilder.DropColumn(
                name: "Hex",
                table: "VariantOptions");

            migrationBuilder.DropColumn(
                name: "Pieces",
                table: "Units");

            migrationBuilder.DropColumn(
                name: "SeasonId",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "Prefix",
                table: "Departments");

            migrationBuilder.DropColumn(
                name: "Prefix",
                table: "Branches");
        }
    }
}
