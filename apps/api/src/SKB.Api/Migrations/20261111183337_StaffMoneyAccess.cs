using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class StaffMoneyAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MoneyHistoryDays",
                table: "Staff",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NoMoneyAccounts",
                table: "Staff",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MoneyHistoryDays",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "NoMoneyAccounts",
                table: "Staff");
        }
    }
}
