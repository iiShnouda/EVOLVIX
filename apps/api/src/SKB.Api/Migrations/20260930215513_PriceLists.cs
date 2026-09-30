using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PriceLists : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PurchasePriceListId",
                table: "Parties",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SalesPriceListId",
                table: "Parties",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PriceLists",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Side = table.Column<string>(type: "text", nullable: false),
                    ForEveryone = table.Column<bool>(type: "boolean", nullable: false),
                    ValidFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ValidTo = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PriceLists", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "QuantityBreaks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: true),
                    ModelId = table.Column<Guid>(type: "uuid", nullable: true),
                    MinQuantity = table.Column<int>(type: "integer", nullable: false),
                    PercentBp = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuantityBreaks", x => x.Id);
                    table.CheckConstraint("CK_QuantityBreak_Target", "(\"ProductId\" IS NULL) <> (\"ModelId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_QuantityBreaks_ProductModels_ModelId",
                        column: x => x.ModelId,
                        principalTable: "ProductModels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_QuantityBreaks_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PriceListItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ListId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: true),
                    ModelId = table.Column<Guid>(type: "uuid", nullable: true),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    Price = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PriceListItems", x => x.Id);
                    table.CheckConstraint("CK_PriceListItem_Target", "(\"ProductId\" IS NULL) <> (\"ModelId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_PriceListItems_PriceLists_ListId",
                        column: x => x.ListId,
                        principalTable: "PriceLists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PriceListItems_ProductModels_ModelId",
                        column: x => x.ModelId,
                        principalTable: "ProductModels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PriceListItems_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PriceListItems_Units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "Units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Parties_PurchasePriceListId",
                table: "Parties",
                column: "PurchasePriceListId");

            migrationBuilder.CreateIndex(
                name: "IX_Parties_SalesPriceListId",
                table: "Parties",
                column: "SalesPriceListId");

            migrationBuilder.CreateIndex(
                name: "IX_PriceListItems_ListId_ModelId_UnitId",
                table: "PriceListItems",
                columns: new[] { "ListId", "ModelId", "UnitId" },
                unique: true,
                filter: "\"ModelId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PriceListItems_ListId_ProductId_UnitId",
                table: "PriceListItems",
                columns: new[] { "ListId", "ProductId", "UnitId" },
                unique: true,
                filter: "\"ProductId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PriceListItems_ModelId",
                table: "PriceListItems",
                column: "ModelId");

            migrationBuilder.CreateIndex(
                name: "IX_PriceListItems_ProductId",
                table: "PriceListItems",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_PriceListItems_UnitId",
                table: "PriceListItems",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_QuantityBreaks_ModelId_MinQuantity",
                table: "QuantityBreaks",
                columns: new[] { "ModelId", "MinQuantity" },
                unique: true,
                filter: "\"ModelId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_QuantityBreaks_ProductId_MinQuantity",
                table: "QuantityBreaks",
                columns: new[] { "ProductId", "MinQuantity" },
                unique: true,
                filter: "\"ProductId\" IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_Parties_PriceLists_PurchasePriceListId",
                table: "Parties",
                column: "PurchasePriceListId",
                principalTable: "PriceLists",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Parties_PriceLists_SalesPriceListId",
                table: "Parties",
                column: "SalesPriceListId",
                principalTable: "PriceLists",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Parties_PriceLists_PurchasePriceListId",
                table: "Parties");

            migrationBuilder.DropForeignKey(
                name: "FK_Parties_PriceLists_SalesPriceListId",
                table: "Parties");

            migrationBuilder.DropTable(
                name: "PriceListItems");

            migrationBuilder.DropTable(
                name: "QuantityBreaks");

            migrationBuilder.DropTable(
                name: "PriceLists");

            migrationBuilder.DropIndex(
                name: "IX_Parties_PurchasePriceListId",
                table: "Parties");

            migrationBuilder.DropIndex(
                name: "IX_Parties_SalesPriceListId",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "PurchasePriceListId",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "SalesPriceListId",
                table: "Parties");
        }
    }
}
