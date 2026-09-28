using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class LocalizedNames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
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
                defaultValue: "en");

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
                defaultValue: "en");

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
                defaultValue: "en");

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
                defaultValue: "en");

            // Existing names were all typed in English: keep them as the English source and mark the
            // Arabic side as waiting for AI translation. The transit warehouse is named in both.
            migrationBuilder.Sql("""
                UPDATE "Branches"   SET "NameEn" = "Name", "NameSource" = 'en', "NamePending" = TRUE WHERE "NameEn" IS NULL AND "NameAr" IS NULL;
                UPDATE "Warehouses" SET "NameEn" = "Name", "NameSource" = 'en', "NamePending" = TRUE WHERE "NameEn" IS NULL AND "NameAr" IS NULL;
                UPDATE "Categories" SET "NameEn" = "Name", "NameSource" = 'en', "NamePending" = TRUE WHERE "NameEn" IS NULL AND "NameAr" IS NULL;
                UPDATE "Products"   SET "NameEn" = "Name", "NameSource" = 'en', "NamePending" = TRUE WHERE "NameEn" IS NULL AND "NameAr" IS NULL;
                UPDATE "Warehouses" SET "NameEn" = 'In transit', "NameAr" = 'في الطريق', "NamePending" = FALSE WHERE "Kind" = 'TRANSIT';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
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
    }
}
