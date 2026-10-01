using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class CompanyLogo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LogoVersion",
                table: "CompanySettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "CompanyLogos",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContentType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Data = table.Column<byte[]>(type: "bytea", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyLogos", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CompanyLogos");

            migrationBuilder.DropColumn(
                name: "LogoVersion",
                table: "CompanySettings");
        }
    }
}
