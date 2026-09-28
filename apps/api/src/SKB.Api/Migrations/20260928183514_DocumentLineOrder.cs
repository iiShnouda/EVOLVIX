using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class DocumentLineOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LineNo",
                table: "DocumentLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Existing lines get a stable 1-based order within their document.
            migrationBuilder.Sql("""
                UPDATE "DocumentLines" l
                SET "LineNo" = r.n
                FROM (SELECT "Id", row_number() OVER (PARTITION BY "DocumentId" ORDER BY "Id") AS n
                      FROM "DocumentLines") r
                WHERE r."Id" = l."Id";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LineNo",
                table: "DocumentLines");
        }
    }
}
