using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class NotificationsEverywhere : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Data",
                table: "Notifications",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AlertStage",
                table: "Notes",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "DailySummaryDay",
                table: "CompanySettings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DailySummaryMinute",
                table: "CompanySettings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NoteAlertDays",
                table: "CompanySettings",
                type: "integer",
                nullable: false,
                defaultValue: 3);

            // The daily summary starts at 21:00 for a company that had none; cheques already past
            // their day are not told of all at once (the summary counts them).
            migrationBuilder.Sql("UPDATE \"CompanySettings\" SET \"DailySummaryMinute\" = 1260;");
            migrationBuilder.Sql("UPDATE \"Notes\" SET \"AlertStage\" = 2 WHERE \"DueDate\" < now() - interval '1 day';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Data",
                table: "Notifications");

            migrationBuilder.DropColumn(
                name: "AlertStage",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "DailySummaryDay",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "DailySummaryMinute",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "NoteAlertDays",
                table: "CompanySettings");
        }
    }
}
