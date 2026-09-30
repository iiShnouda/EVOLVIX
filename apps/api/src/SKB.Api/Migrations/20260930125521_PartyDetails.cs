using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PartyDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContactName",
                table: "Parties",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "Parties",
                type: "text",
                nullable: true);

            // Existing parties get an empty list (a NOT NULL column needs a default on a filled table).
            migrationBuilder.AddColumn<List<string>>(
                name: "OtherPhones",
                table: "Parties",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<string>(
                name: "ShippingAddress",
                table: "Parties",
                type: "text",
                nullable: true);

            // A factory is a supplier (owner decision 2026-09-30): every FACTORY becomes SUPPLIER,
            // without listing SUPPLIER twice. Their ledger sub-accounts already sat under Suppliers.
            migrationBuilder.Sql("""
                UPDATE "Parties"
                SET "Types" = (SELECT array_agg(DISTINCT t ORDER BY t)
                               FROM unnest(array_replace("Types", 'FACTORY', 'SUPPLIER')) AS t)
                WHERE 'FACTORY' = ANY("Types");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Which suppliers used to be marked FACTORY is not kept, so they stay SUPPLIER.
            migrationBuilder.DropColumn(
                name: "ContactName",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "OtherPhones",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "ShippingAddress",
                table: "Parties");
        }
    }
}
