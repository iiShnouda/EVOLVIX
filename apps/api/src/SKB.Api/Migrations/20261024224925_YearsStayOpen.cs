using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    /// <summary>
    /// Past years stay open (owner, 2026-10-24): closing a year no longer locks it, so the lock a
    /// year-end close set (on its 31 December) is lifted. A lock someone set on another day stays.
    /// </summary>
    public partial class YearsStayOpen : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "CompanySettings" SET "LockDate" = NULL
                WHERE "LockDate" IS NOT NULL
                  AND "LockDate" = (SELECT MAX("Date") - interval '12 hours' FROM "JournalEntries"
                                    WHERE "SourceType" = 'YEAR_CLOSE');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
