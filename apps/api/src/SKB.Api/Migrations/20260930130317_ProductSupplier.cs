using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProductSupplier : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SupplierCode",
                table: "Products",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SupplierId",
                table: "Products",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupplierCode",
                table: "ProductModels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SupplierId",
                table: "ProductModels",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Products_SupplierId",
                table: "Products",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductModels_SupplierId",
                table: "ProductModels",
                column: "SupplierId");

            migrationBuilder.AddForeignKey(
                name: "FK_ProductModels_Parties_SupplierId",
                table: "ProductModels",
                column: "SupplierId",
                principalTable: "Parties",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Products_Parties_SupplierId",
                table: "Products",
                column: "SupplierId",
                principalTable: "Parties",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ProductModels_Parties_SupplierId",
                table: "ProductModels");

            migrationBuilder.DropForeignKey(
                name: "FK_Products_Parties_SupplierId",
                table: "Products");

            migrationBuilder.DropIndex(
                name: "IX_Products_SupplierId",
                table: "Products");

            migrationBuilder.DropIndex(
                name: "IX_ProductModels_SupplierId",
                table: "ProductModels");

            migrationBuilder.DropColumn(
                name: "SupplierCode",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "SupplierId",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "SupplierCode",
                table: "ProductModels");

            migrationBuilder.DropColumn(
                name: "SupplierId",
                table: "ProductModels");
        }
    }
}
