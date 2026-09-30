using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class CreditLimitAndHold : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "CreditLimit",
                table: "Parties",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PendingHoldDays",
                table: "CompanySettings",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreditLimit",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "PendingHoldDays",
                table: "CompanySettings");
        }
    }
}
