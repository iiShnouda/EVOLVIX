using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The next document number looks up the highest one after a prefix ("INV-2026-%"). A plain
            // index can't serve that search unless the database's collation is "C", so every save read
            // every document; this one reads only the numbers under the prefix.
            migrationBuilder.Sql(
                @"CREATE INDEX IF NOT EXISTS ""IX_SalesDocuments_Number_Prefix"" ON ""SalesDocuments"" (""Number"" text_pattern_ops);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_SalesDocuments_Number_Prefix"";");
        }
    }
}
