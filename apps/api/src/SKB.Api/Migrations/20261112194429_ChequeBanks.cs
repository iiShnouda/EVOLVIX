using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class ChequeBanks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "BankId",
                table: "Notes",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BroughtByParty",
                table: "Notes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "Banks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Banks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Notes_BankId",
                table: "Notes",
                column: "BankId");

            migrationBuilder.CreateIndex(
                name: "IX_Banks_Name",
                table: "Banks",
                column: "Name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Notes_Banks_BankId",
                table: "Notes",
                column: "BankId",
                principalTable: "Banks",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // The list starts with the banks already typed on cheques (one spelling per name), and
            // each cheque points at its bank; the name typed stays on the cheque.
            migrationBuilder.Sql("""
                INSERT INTO "Banks" ("Id", "Name", "CreatedAt")
                SELECT gen_random_uuid(), n, now()
                FROM (SELECT DISTINCT ON (lower(left(btrim("BankName"), 100))) left(btrim("BankName"), 100) AS n
                      FROM "Notes" WHERE "BankName" IS NOT NULL AND btrim("BankName") <> ''
                      ORDER BY lower(left(btrim("BankName"), 100)), "CreatedAt") AS names;
                """);
            migrationBuilder.Sql("""
                UPDATE "Notes" AS t SET "BankId" = b."Id"
                FROM "Banks" AS b WHERE t."BankName" IS NOT NULL AND lower(left(btrim(t."BankName"), 100)) = lower(b."Name");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Notes_Banks_BankId",
                table: "Notes");

            migrationBuilder.DropTable(
                name: "Banks");

            migrationBuilder.DropIndex(
                name: "IX_Notes_BankId",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "BankId",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "BroughtByParty",
                table: "Notes");
        }
    }
}
