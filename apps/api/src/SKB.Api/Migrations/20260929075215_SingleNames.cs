using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class SingleNames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Owner decision 2026-09-29: one name, kept as typed, never translated. The name each
            // record already shows as typed (Name) stays. The starter units and price levels that
            // the system itself created in both languages switch to their Arabic name, the
            // company's working language; anything a person typed keeps exactly what they typed.
            migrationBuilder.Sql("""
                UPDATE "Units" SET "Name" = "NameAr"
                WHERE "NameAuto" IS NULL AND "NameAr" IS NOT NULL AND btrim("NameAr") <> ''
                  AND "NameEn" IS NOT NULL AND "Name" = "NameEn";
                UPDATE "PriceLevels" SET "Name" = "NameAr"
                WHERE "NameAuto" IS NULL AND "NameAr" IS NOT NULL AND btrim("NameAr") <> ''
                  AND "NameEn" IS NOT NULL AND "Name" = "NameEn";
                """);

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "Warehouses");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "Warehouses");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "Warehouses");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "Warehouses");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "Warehouses");

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "VariantOptions");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "VariantOptions");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "VariantOptions");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "VariantOptions");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "VariantOptions");

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "Units");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "Units");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "Units");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "Units");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "Units");

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "Products");

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "ProductModels");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "ProductModels");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "ProductModels");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "ProductModels");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "ProductModels");

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "PriceLevels");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "PriceLevels");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "PriceLevels");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "PriceLevels");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "PriceLevels");

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "NameAr",
                table: "Branches");

            migrationBuilder.DropColumn(
                name: "NameAuto",
                table: "Branches");

            migrationBuilder.DropColumn(
                name: "NameEn",
                table: "Branches");

            migrationBuilder.DropColumn(
                name: "NamePending",
                table: "Branches");

            migrationBuilder.DropColumn(
                name: "NameSource",
                table: "Branches");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "Warehouses",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "Warehouses",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "Warehouses",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "Warehouses",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "Warehouses",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "VariantOptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "VariantOptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "VariantOptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "VariantOptions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "VariantOptions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "Units",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "Units",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "Units",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "Units",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "Units",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "Products",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "Products",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "Products",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "Products",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "Products",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "ProductModels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "ProductModels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "ProductModels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "ProductModels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "ProductModels",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "PriceLevels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "PriceLevels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "PriceLevels",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "PriceLevels",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "PriceLevels",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "Categories",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "Categories",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "Categories",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "Categories",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "Categories",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NameAr",
                table: "Branches",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameAuto",
                table: "Branches",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NameEn",
                table: "Branches",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NamePending",
                table: "Branches",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "NameSource",
                table: "Branches",
                type: "text",
                nullable: false,
                defaultValue: "");
        }
    }
}
