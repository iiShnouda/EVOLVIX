using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PhonesIdsPasswordNote : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<string>>(
                name: "OtherPhoneLabels",
                table: "Staff",
                type: "text[]",
                nullable: false);

            migrationBuilder.AddColumn<List<string>>(
                name: "OtherPhones",
                table: "Staff",
                type: "text[]",
                nullable: false);

            migrationBuilder.AddColumn<byte[]>(
                name: "PasswordNote",
                table: "Staff",
                type: "bytea",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NationalId",
                table: "Parties",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "OtherPhoneLabels",
                table: "Employees",
                type: "text[]",
                nullable: false);

            migrationBuilder.AddColumn<List<string>>(
                name: "OtherPhones",
                table: "Employees",
                type: "text[]",
                nullable: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OtherPhoneLabels",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "OtherPhones",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "PasswordNote",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "NationalId",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "OtherPhoneLabels",
                table: "Employees");

            migrationBuilder.DropColumn(
                name: "OtherPhones",
                table: "Employees");
        }
    }
}
