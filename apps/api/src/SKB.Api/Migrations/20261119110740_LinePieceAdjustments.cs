using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class LinePieceAdjustments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "DiscountPieceFixed",
                table: "DocumentLines",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "IncreasePieceFixed",
                table: "DocumentLines",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DiscountPieceFixed",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "IncreasePieceFixed",
                table: "DocumentLines");
        }
    }
}
