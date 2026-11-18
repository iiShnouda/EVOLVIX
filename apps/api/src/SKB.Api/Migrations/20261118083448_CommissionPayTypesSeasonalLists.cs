using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class CommissionPayTypesSeasonalLists : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DepartmentSeason",
                table: "PriceLists",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SeasonId",
                table: "PriceLists",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PaidDays",
                table: "PayrollLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<long>(
                name: "PayRate",
                table: "PayrollLines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "PayType",
                table: "PayrollLines",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "MONTHLY");

            migrationBuilder.AddColumn<int>(
                name: "WorkedMinutes",
                table: "PayrollLines",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "CommissionRepId",
                table: "PayrollAdjustments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LeaveDate",
                table: "Employees",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "PayRate",
                table: "Employees",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "PayType",
                table: "Employees",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "MONTHLY");

            migrationBuilder.AddColumn<bool>(
                name: "PaidHolidays",
                table: "CompanySettings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "CommissionRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    Basis = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    PercentBp = table.Column<int>(type: "integer", nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    StartDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommissionRules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CommissionRules_Departments_DepartmentId",
                        column: x => x.DepartmentId,
                        principalTable: "Departments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CommissionRules_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PriceLists_SeasonId",
                table: "PriceLists",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollAdjustments_CommissionRepId_Year_Month",
                table: "PayrollAdjustments",
                columns: new[] { "CommissionRepId", "Year", "Month" },
                unique: true,
                filter: "\"CommissionRepId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CommissionRules_DepartmentId",
                table: "CommissionRules",
                column: "DepartmentId");

            migrationBuilder.CreateIndex(
                name: "IX_CommissionRules_StaffId",
                table: "CommissionRules",
                column: "StaffId");

            migrationBuilder.AddForeignKey(
                name: "FK_PriceLists_Seasons_SeasonId",
                table: "PriceLists",
                column: "SeasonId",
                principalTable: "Seasons",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PriceLists_Seasons_SeasonId",
                table: "PriceLists");

            migrationBuilder.DropTable(
                name: "CommissionRules");

            migrationBuilder.DropIndex(
                name: "IX_PriceLists_SeasonId",
                table: "PriceLists");

            migrationBuilder.DropIndex(
                name: "IX_PayrollAdjustments_CommissionRepId_Year_Month",
                table: "PayrollAdjustments");

            migrationBuilder.DropColumn(
                name: "DepartmentSeason",
                table: "PriceLists");

            migrationBuilder.DropColumn(
                name: "SeasonId",
                table: "PriceLists");

            migrationBuilder.DropColumn(
                name: "PaidDays",
                table: "PayrollLines");

            migrationBuilder.DropColumn(
                name: "PayRate",
                table: "PayrollLines");

            migrationBuilder.DropColumn(
                name: "PayType",
                table: "PayrollLines");

            migrationBuilder.DropColumn(
                name: "WorkedMinutes",
                table: "PayrollLines");

            migrationBuilder.DropColumn(
                name: "CommissionRepId",
                table: "PayrollAdjustments");

            migrationBuilder.DropColumn(
                name: "LeaveDate",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "PayRate",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "PayType",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "PaidHolidays",
                table: "CompanySettings");
        }
    }
}
