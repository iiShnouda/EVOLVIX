using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class SalesPurchaseReturns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SourceDocumentId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceLineId",
                table: "DocumentLines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_SourceDocumentId",
                table: "SalesDocuments",
                column: "SourceDocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentLines_SourceLineId",
                table: "DocumentLines",
                column: "SourceLineId");

            migrationBuilder.AddForeignKey(
                name: "FK_SalesDocuments_SalesDocuments_SourceDocumentId",
                table: "SalesDocuments",
                column: "SourceDocumentId",
                principalTable: "SalesDocuments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SalesDocuments_SalesDocuments_SourceDocumentId",
                table: "SalesDocuments");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_SourceDocumentId",
                table: "SalesDocuments");

            migrationBuilder.DropIndex(
                name: "IX_DocumentLines_SourceLineId",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "SourceDocumentId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "SourceLineId",
                table: "DocumentLines");
        }
    }
}
