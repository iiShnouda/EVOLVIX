using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class DepartmentSeasons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SeasonKind",
                table: "SalesDocuments",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasSeasons",
                table: "Departments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Every department the company has now comes by season (owner, 2026-11-10: "all
            // departments"); one without seasons is switched off in its editor.
            migrationBuilder.Sql("UPDATE \"Departments\" SET \"HasSeasons\" = TRUE;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SeasonKind",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "HasSeasons",
                table: "Departments");
        }
    }
}
