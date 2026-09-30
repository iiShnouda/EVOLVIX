using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class StaffAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllBranches",
                table: "Staff",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<List<Guid>>(
                name: "BranchIds",
                table: "Staff",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<List<Guid>>(
                name: "MoneyAccountIds",
                table: "Staff",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<List<Guid>>(
                name: "WarehouseIds",
                table: "Staff",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AllBranches",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "BranchIds",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "MoneyAccountIds",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "WarehouseIds",
                table: "Staff");
        }
    }
}
