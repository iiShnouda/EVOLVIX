using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class ChargesBonusReps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "AdditionTotal",
                table: "SalesDocuments",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<Guid>(
                name: "RepId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "DocDiscount",
                table: "DocumentLines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<bool>(
                name: "IsBonus",
                table: "DocumentLines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "DocumentCharges",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    RateBp = table.Column<int>(type: "integer", nullable: true),
                    FixedAmount = table.Column<long>(type: "bigint", nullable: true),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DocumentCharges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DocumentCharges_SalesDocuments_DocumentId",
                        column: x => x.DocumentId,
                        principalTable: "SalesDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_RepId",
                table: "SalesDocuments",
                column: "RepId");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentCharges_DocumentId",
                table: "DocumentCharges",
                column: "DocumentId");

            migrationBuilder.AddForeignKey(
                name: "FK_SalesDocuments_Staff_RepId",
                table: "SalesDocuments",
                column: "RepId",
                principalTable: "Staff",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SalesDocuments_Staff_RepId",
                table: "SalesDocuments");

            migrationBuilder.DropTable(
                name: "DocumentCharges");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_RepId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "AdditionTotal",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "RepId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "DocDiscount",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "IsBonus",
                table: "DocumentLines");
        }
    }
}
