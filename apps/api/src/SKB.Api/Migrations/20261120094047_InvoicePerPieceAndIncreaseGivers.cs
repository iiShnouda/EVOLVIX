using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class InvoicePerPieceAndIncreaseGivers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "IncreaseById",
                table: "DocumentLines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncreaseByName",
                table: "DocumentLines",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ById",
                table: "DocumentCharges",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ByName",
                table: "DocumentCharges",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "PieceFixed",
                table: "DocumentCharges",
                type: "bigint",
                nullable: true);

            // Increases given before their giver was kept: the invoice's maker gave them.
            migrationBuilder.Sql("""
                UPDATE "DocumentLines" l SET "IncreaseById" = d."StaffId", "IncreaseByName" = s."FullName"
                FROM "SalesDocuments" d LEFT JOIN "Staff" s ON s."Id" = d."StaffId"
                WHERE l."DocumentId" = d."Id" AND l."Increase" > 0 AND l."IncreaseById" IS NULL;
                UPDATE "DocumentCharges" c SET "ById" = d."StaffId", "ByName" = s."FullName"
                FROM "SalesDocuments" d LEFT JOIN "Staff" s ON s."Id" = d."StaffId"
                WHERE c."DocumentId" = d."Id" AND c."Kind" = 'INCREASE' AND c."ById" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IncreaseById",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "IncreaseByName",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "ById",
                table: "DocumentCharges");

            migrationBuilder.DropColumn(
                name: "ByName",
                table: "DocumentCharges");

            migrationBuilder.DropColumn(
                name: "PieceFixed",
                table: "DocumentCharges");
        }
    }
}
