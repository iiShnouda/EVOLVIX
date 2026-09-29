using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class UnitsPricesVariants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PriceLevelId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ColorId",
                table: "Products",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ModelId",
                table: "Products",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SizeId",
                table: "Products",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PurchasePriceLevelId",
                table: "Parties",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SalesPriceLevelId",
                table: "Parties",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UnitFactor",
                table: "DocumentLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "UnitId",
                table: "DocumentLines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UnitQuantity",
                table: "DocumentLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "PriceLevels",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    NameAr = table.Column<string>(type: "text", nullable: true),
                    NameEn = table.Column<string>(type: "text", nullable: true),
                    NameSource = table.Column<string>(type: "text", nullable: false),
                    NameAuto = table.Column<string>(type: "text", nullable: true),
                    NamePending = table.Column<bool>(type: "boolean", nullable: false),
                    Side = table.Column<string>(type: "text", nullable: false),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PriceLevels", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ProductModels",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    NameAr = table.Column<string>(type: "text", nullable: true),
                    NameEn = table.Column<string>(type: "text", nullable: true),
                    NameSource = table.Column<string>(type: "text", nullable: false),
                    NameAuto = table.Column<string>(type: "text", nullable: true),
                    NamePending = table.Column<bool>(type: "boolean", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReorderLevel = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductModels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProductModels_Categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "Categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Units",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    NameAr = table.Column<string>(type: "text", nullable: true),
                    NameEn = table.Column<string>(type: "text", nullable: true),
                    NameSource = table.Column<string>(type: "text", nullable: false),
                    NameAuto = table.Column<string>(type: "text", nullable: true),
                    NamePending = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Units", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "VariantOptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    NameAr = table.Column<string>(type: "text", nullable: true),
                    NameEn = table.Column<string>(type: "text", nullable: true),
                    NameSource = table.Column<string>(type: "text", nullable: false),
                    NameAuto = table.Column<string>(type: "text", nullable: true),
                    NamePending = table.Column<bool>(type: "boolean", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VariantOptions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ItemPrices",
                columns: table => new
                {
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceLevelId = table.Column<Guid>(type: "uuid", nullable: false),
                    Price = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ItemPrices", x => new { x.ProductId, x.UnitId, x.PriceLevelId });
                    table.ForeignKey(
                        name: "FK_ItemPrices_PriceLevels_PriceLevelId",
                        column: x => x.PriceLevelId,
                        principalTable: "PriceLevels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ItemPrices_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ModelPrices",
                columns: table => new
                {
                    ModelId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    PriceLevelId = table.Column<Guid>(type: "uuid", nullable: false),
                    Price = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ModelPrices", x => new { x.ModelId, x.UnitId, x.PriceLevelId });
                    table.ForeignKey(
                        name: "FK_ModelPrices_PriceLevels_PriceLevelId",
                        column: x => x.PriceLevelId,
                        principalTable: "PriceLevels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ModelPrices_ProductModels_ModelId",
                        column: x => x.ModelId,
                        principalTable: "ProductModels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ItemUnits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    Factor = table.Column<int>(type: "integer", nullable: false),
                    Barcode = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ItemUnits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ItemUnits_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ItemUnits_Units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "Units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ModelUnits",
                columns: table => new
                {
                    ModelId = table.Column<Guid>(type: "uuid", nullable: false),
                    UnitId = table.Column<Guid>(type: "uuid", nullable: false),
                    Factor = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ModelUnits", x => new { x.ModelId, x.UnitId });
                    table.ForeignKey(
                        name: "FK_ModelUnits_ProductModels_ModelId",
                        column: x => x.ModelId,
                        principalTable: "ProductModels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ModelUnits_Units_UnitId",
                        column: x => x.UnitId,
                        principalTable: "Units",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_PriceLevelId",
                table: "SalesDocuments",
                column: "PriceLevelId");

            migrationBuilder.CreateIndex(
                name: "IX_Products_ColorId",
                table: "Products",
                column: "ColorId");

            migrationBuilder.CreateIndex(
                name: "IX_Products_ModelId_SizeId_ColorId",
                table: "Products",
                columns: new[] { "ModelId", "SizeId", "ColorId" },
                unique: true,
                filter: "\"ModelId\" IS NOT NULL")
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_Products_SizeId",
                table: "Products",
                column: "SizeId");

            migrationBuilder.CreateIndex(
                name: "IX_Parties_PurchasePriceLevelId",
                table: "Parties",
                column: "PurchasePriceLevelId");

            migrationBuilder.CreateIndex(
                name: "IX_Parties_SalesPriceLevelId",
                table: "Parties",
                column: "SalesPriceLevelId");

            migrationBuilder.CreateIndex(
                name: "IX_DocumentLines_UnitId",
                table: "DocumentLines",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_ItemPrices_PriceLevelId",
                table: "ItemPrices",
                column: "PriceLevelId");

            migrationBuilder.CreateIndex(
                name: "IX_ItemUnits_Barcode",
                table: "ItemUnits",
                column: "Barcode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ItemUnits_ProductId_UnitId",
                table: "ItemUnits",
                columns: new[] { "ProductId", "UnitId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ItemUnits_UnitId",
                table: "ItemUnits",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_ModelPrices_PriceLevelId",
                table: "ModelPrices",
                column: "PriceLevelId");

            migrationBuilder.CreateIndex(
                name: "IX_ModelUnits_UnitId",
                table: "ModelUnits",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductModels_CategoryId",
                table: "ProductModels",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductModels_Code",
                table: "ProductModels",
                column: "Code",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_DocumentLines_Units_UnitId",
                table: "DocumentLines",
                column: "UnitId",
                principalTable: "Units",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Parties_PriceLevels_PurchasePriceLevelId",
                table: "Parties",
                column: "PurchasePriceLevelId",
                principalTable: "PriceLevels",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Parties_PriceLevels_SalesPriceLevelId",
                table: "Parties",
                column: "SalesPriceLevelId",
                principalTable: "PriceLevels",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Products_ProductModels_ModelId",
                table: "Products",
                column: "ModelId",
                principalTable: "ProductModels",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Products_VariantOptions_ColorId",
                table: "Products",
                column: "ColorId",
                principalTable: "VariantOptions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Products_VariantOptions_SizeId",
                table: "Products",
                column: "SizeId",
                principalTable: "VariantOptions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesDocuments_PriceLevels_PriceLevelId",
                table: "SalesDocuments",
                column: "PriceLevelId",
                principalTable: "PriceLevels",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // ---- Existing data (no-op on a fresh database) -------------------------------------
            // 1. Units: every unit name items use today becomes a unit (known ones in both
            //    languages; others wait for AI translation), plus piece, carton and dozen.
            migrationBuilder.Sql("""
                WITH known(key, en, ar) AS (VALUES
                    ('pc', 'Piece', 'قطعة'), ('piece', 'Piece', 'قطعة'), ('pcs', 'Piece', 'قطعة'),
                    ('pack', 'Pack', 'عبوة'), ('case', 'Case', 'صندوق'), ('box', 'Box', 'علبة'),
                    ('bundle', 'Bundle', 'ربطة'), ('roll', 'Roll', 'رول'), ('carton', 'Carton', 'كرتونة'),
                    ('ctn', 'Carton', 'كرتونة'), ('dozen', 'Dozen', 'دستة'), ('kg', 'Kilogram', 'كيلوجرام'),
                    ('bag', 'Bag', 'شيكارة'), ('bottle', 'Bottle', 'زجاجة'), ('can', 'Can', 'علبة صفيح')),
                used AS (
                    SELECT DISTINCT COALESCE(NULLIF(lower(btrim("Unit")), ''), 'pc') AS key FROM "Products"
                    UNION SELECT 'pc' UNION SELECT 'carton' UNION SELECT 'dozen'),
                named AS (
                    SELECT DISTINCT ON (COALESCE(k.en, u.key)) u.key, COALESCE(k.en, u.key) AS en, k.ar
                    FROM used u LEFT JOIN known k ON k.key = u.key
                    ORDER BY COALESCE(k.en, u.key), u.key)
                INSERT INTO "Units" ("Id", "Name", "NameAr", "NameEn", "NameSource", "NameAuto", "NamePending", "IsActive", "CreatedAt")
                SELECT gen_random_uuid(), en, ar, en, 'en', NULL, ar IS NULL, TRUE, now() FROM named
                WHERE EXISTS (SELECT 1 FROM "Products");
                """);

            // 2. Each item's base unit (factor 1) is the unit it had; its barcode moves onto it (a
            //    barcode two items shared stays with the first).
            migrationBuilder.Sql("""
                WITH known(key, en) AS (VALUES
                    ('pc', 'Piece'), ('piece', 'Piece'), ('pcs', 'Piece'), ('pack', 'Pack'), ('case', 'Case'),
                    ('box', 'Box'), ('bundle', 'Bundle'), ('roll', 'Roll'), ('carton', 'Carton'), ('ctn', 'Carton'),
                    ('dozen', 'Dozen'), ('kg', 'Kilogram'), ('bag', 'Bag'), ('bottle', 'Bottle'), ('can', 'Can')),
                items AS (
                    SELECT p."Id", COALESCE(NULLIF(lower(btrim(p."Unit")), ''), 'pc') AS key,
                           NULLIF(btrim(p."Barcode"), '') AS barcode,
                           row_number() OVER (PARTITION BY lower(NULLIF(btrim(p."Barcode"), '')) ORDER BY p."CreatedAt", p."Id") AS nth
                    FROM "Products" p)
                INSERT INTO "ItemUnits" ("Id", "ProductId", "UnitId", "Factor", "Barcode")
                SELECT gen_random_uuid(), i."Id", u."Id", 1, CASE WHEN i.nth = 1 THEN i.barcode END
                FROM items i
                LEFT JOIN known k ON k.key = i.key
                JOIN "Units" u ON u."NameEn" = COALESCE(k.en, i.key);
                """);

            // 3. Price levels: the customer price (sales) and the supplier price (purchases), each
            //    its side's default. Only when there are items (a fresh database is seeded instead).
            migrationBuilder.Sql("""
                INSERT INTO "PriceLevels" ("Id", "Name", "NameAr", "NameEn", "NameSource", "NameAuto", "NamePending", "Side", "IsDefault", "SortOrder", "IsActive", "CreatedAt")
                SELECT gen_random_uuid(), 'Customer price', 'سعر العملاء', 'Customer price', 'en', NULL, FALSE, 'SALE', TRUE, 1, TRUE, now()
                WHERE EXISTS (SELECT 1 FROM "Products")
                UNION ALL
                SELECT gen_random_uuid(), 'Supplier price', 'سعر الموردين', 'Supplier price', 'en', NULL, FALSE, 'PURCHASE', TRUE, 1, TRUE, now()
                WHERE EXISTS (SELECT 1 FROM "Products");
                """);

            // 4. Today's sale price becomes the base unit's customer price.
            migrationBuilder.Sql("""
                INSERT INTO "ItemPrices" ("ProductId", "UnitId", "PriceLevelId", "Price", "UpdatedAt")
                SELECT p."Id", iu."UnitId", l."Id", p."SalePrice", now()
                FROM "Products" p
                JOIN "ItemUnits" iu ON iu."ProductId" = p."Id" AND iu."Factor" = 1
                JOIN "PriceLevels" l ON l."Side" = 'SALE' AND l."IsDefault";
                """);

            // 5. Every existing invoice / return line was entered in its item's base unit.
            migrationBuilder.Sql("""
                UPDATE "DocumentLines" l
                SET "UnitId" = iu."UnitId", "UnitFactor" = 1, "UnitQuantity" = l."Quantity"
                FROM "ItemUnits" iu
                WHERE iu."ProductId" = l."ProductId" AND iu."Factor" = 1;
                UPDATE "DocumentLines" SET "UnitFactor" = 1, "UnitQuantity" = "Quantity" WHERE "UnitFactor" = 0;
                """);

            migrationBuilder.DropColumn(
                name: "Barcode",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "Products");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DocumentLines_Units_UnitId",
                table: "DocumentLines");

            migrationBuilder.DropForeignKey(
                name: "FK_Parties_PriceLevels_PurchasePriceLevelId",
                table: "Parties");

            migrationBuilder.DropForeignKey(
                name: "FK_Parties_PriceLevels_SalesPriceLevelId",
                table: "Parties");

            migrationBuilder.DropForeignKey(
                name: "FK_Products_ProductModels_ModelId",
                table: "Products");

            migrationBuilder.DropForeignKey(
                name: "FK_Products_VariantOptions_ColorId",
                table: "Products");

            migrationBuilder.DropForeignKey(
                name: "FK_Products_VariantOptions_SizeId",
                table: "Products");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesDocuments_PriceLevels_PriceLevelId",
                table: "SalesDocuments");

            migrationBuilder.DropTable(
                name: "ItemPrices");

            migrationBuilder.DropTable(
                name: "ItemUnits");

            migrationBuilder.DropTable(
                name: "ModelPrices");

            migrationBuilder.DropTable(
                name: "ModelUnits");

            migrationBuilder.DropTable(
                name: "VariantOptions");

            migrationBuilder.DropTable(
                name: "PriceLevels");

            migrationBuilder.DropTable(
                name: "ProductModels");

            migrationBuilder.DropTable(
                name: "Units");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_PriceLevelId",
                table: "SalesDocuments");

            migrationBuilder.DropIndex(
                name: "IX_Products_ColorId",
                table: "Products");

            migrationBuilder.DropIndex(
                name: "IX_Products_ModelId_SizeId_ColorId",
                table: "Products");

            migrationBuilder.DropIndex(
                name: "IX_Products_SizeId",
                table: "Products");

            migrationBuilder.DropIndex(
                name: "IX_Parties_PurchasePriceLevelId",
                table: "Parties");

            migrationBuilder.DropIndex(
                name: "IX_Parties_SalesPriceLevelId",
                table: "Parties");

            migrationBuilder.DropIndex(
                name: "IX_DocumentLines_UnitId",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "PriceLevelId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "ColorId",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "ModelId",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "SizeId",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "PurchasePriceLevelId",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "SalesPriceLevelId",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "UnitFactor",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "UnitId",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "UnitQuantity",
                table: "DocumentLines");

            migrationBuilder.AddColumn<string>(
                name: "Barcode",
                table: "Products",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "Products",
                type: "text",
                nullable: false,
                defaultValue: "");
        }
    }
}
