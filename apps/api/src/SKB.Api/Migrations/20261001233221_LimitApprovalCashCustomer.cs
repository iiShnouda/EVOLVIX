using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class LimitApprovalCashCustomer : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApprovalNote",
                table: "SalesDocuments",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "OverLimit",
                table: "SalesDocuments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsSystem",
                table: "Parties",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ReturnAfterHours",
                table: "CompanySettings",
                type: "integer",
                nullable: false,
                defaultValue: 12);

            // The walk-in cash customer, code 0 (owner, 2026-10-02): always there, never closed.
            migrationBuilder.Sql("""
                INSERT INTO "Parties" ("Id", "Code", "Name", "Types", "OtherPhones", "OtherPhoneLabels", "Balance",
                    "Currency", "IsActive", "CreatedAt", "HasIdFront", "HasIdBack", "IsCashCustomer", "IsSystem")
                SELECT gen_random_uuid(), 0, 'عميل نقدي', ARRAY['CUSTOMER'], ARRAY[]::text[], ARRAY[]::text[], 0,
                    COALESCE((SELECT "Currency" FROM "CompanySettings" LIMIT 1), 'EGP'), TRUE, now(),
                    FALSE, FALSE, TRUE, TRUE
                WHERE NOT EXISTS (SELECT 1 FROM "Parties" WHERE "IsSystem" OR "Code" = 0);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DELETE FROM "Parties" WHERE "IsSystem" AND NOT EXISTS (SELECT 1 FROM "SalesDocuments" d WHERE d."PartyId" = "Parties"."Id");""");
            migrationBuilder.DropColumn(
                name: "ApprovalNote",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "OverLimit",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "IsSystem",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "ReturnAfterHours",
                table: "CompanySettings");
        }
    }
}
