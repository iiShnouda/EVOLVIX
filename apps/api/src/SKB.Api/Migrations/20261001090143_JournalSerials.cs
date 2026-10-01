using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class JournalSerials : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence<int>(
                name: "JournalSerials");

            migrationBuilder.AddColumn<int>(
                name: "Serial",
                table: "JournalEntries",
                type: "integer",
                nullable: false,
                defaultValueSql: "nextval('\"JournalSerials\"')");

            // Entries already made are numbered by date (then by when they were written).
            migrationBuilder.Sql("""
                UPDATE "JournalEntries" e SET "Serial" = n.rn FROM (
                  SELECT "Id", row_number() OVER (ORDER BY "Date", "CreatedAt", "Id") AS rn FROM "JournalEntries") n
                WHERE e."Id" = n."Id";
                SELECT setval('"JournalSerials"', GREATEST((SELECT COALESCE(MAX("Serial"), 0) FROM "JournalEntries"), 1),
                  (SELECT COUNT(*) > 0 FROM "JournalEntries"));
                """);

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_Serial",
                table: "JournalEntries",
                column: "Serial",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_JournalEntries_Serial",
                table: "JournalEntries");

            migrationBuilder.DropColumn(
                name: "Serial",
                table: "JournalEntries");

            migrationBuilder.DropSequence(
                name: "JournalSerials");
        }
    }
}
