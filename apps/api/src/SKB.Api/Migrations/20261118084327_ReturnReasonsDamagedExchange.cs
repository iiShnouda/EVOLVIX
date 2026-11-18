using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class ReturnReasonsDamagedExchange : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ExchangeId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExchangeNumber",
                table: "SalesDocuments",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Damaged",
                table: "DocumentLines",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReasonNote",
                table: "DocumentLines",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReturnReason",
                table: "DocumentLines",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DamagedReturns",
                table: "CompanySettings",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "WAREHOUSE");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ExchangeId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "ExchangeNumber",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "Damaged",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "ReasonNote",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "ReturnReason",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "DamagedReturns",
                table: "CompanySettings");
        }
    }
}
