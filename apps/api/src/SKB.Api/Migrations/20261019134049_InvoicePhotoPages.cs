using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class InvoicePhotoPages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_DocumentImages",
                table: "DocumentImages");

            migrationBuilder.AddColumn<int>(
                name: "Page",
                table: "DocumentImages",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddPrimaryKey(
                name: "PK_DocumentImages",
                table: "DocumentImages",
                columns: new[] { "DocumentId", "Page" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_DocumentImages",
                table: "DocumentImages");

            migrationBuilder.DropColumn(
                name: "Page",
                table: "DocumentImages");

            migrationBuilder.AddPrimaryKey(
                name: "PK_DocumentImages",
                table: "DocumentImages",
                column: "DocumentId");
        }
    }
}
