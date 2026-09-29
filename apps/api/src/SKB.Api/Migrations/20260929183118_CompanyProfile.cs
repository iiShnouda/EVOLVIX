using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class CompanyProfile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "CompanySettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CommercialRegister",
                table: "CompanySettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "CompanySettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "CompanySettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TaxNumber",
                table: "CompanySettings",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Address",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "CommercialRegister",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "TaxNumber",
                table: "CompanySettings");
        }
    }
}
