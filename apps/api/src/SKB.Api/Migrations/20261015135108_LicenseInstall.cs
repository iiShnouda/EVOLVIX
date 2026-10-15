using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class LicenseInstall : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "InstallId",
                table: "CompanySettings",
                type: "uuid",
                nullable: false,
                defaultValueSql: "gen_random_uuid()");

            migrationBuilder.AddColumn<string>(
                name: "LicenseCode",
                table: "CompanySettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "LicenseSigningKey",
                table: "CompanySettings",
                type: "bytea",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "IssuedLicenses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Customer = table.Column<string>(type: "text", nullable: false),
                    InstallId = table.Column<Guid>(type: "uuid", nullable: false),
                    MaxUsers = table.Column<int>(type: "integer", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Code = table.Column<string>(type: "text", nullable: false),
                    IssuedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IssuedLicenses", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IssuedLicenses_CreatedAt",
                table: "IssuedLicenses",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "IssuedLicenses");

            migrationBuilder.DropColumn(
                name: "InstallId",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "LicenseCode",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "LicenseSigningKey",
                table: "CompanySettings");
        }
    }
}
