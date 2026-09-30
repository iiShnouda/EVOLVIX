using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class Departments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<List<Guid>>(
                name: "DepartmentIds",
                table: "Staff",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<int>(
                name: "MaxDiscountPercent",
                table: "Staff",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MaxDiscountPercent",
                table: "CompanySettings",
                type: "integer",
                nullable: false,
                defaultValue: 100);

            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentId",
                table: "Categories",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Departments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Departments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_DepartmentId",
                table: "SalesDocuments",
                column: "DepartmentId");

            migrationBuilder.CreateIndex(
                name: "IX_Categories_DepartmentId",
                table: "Categories",
                column: "DepartmentId");

            migrationBuilder.AddForeignKey(
                name: "FK_Categories_Departments_DepartmentId",
                table: "Categories",
                column: "DepartmentId",
                principalTable: "Departments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesDocuments_Departments_DepartmentId",
                table: "SalesDocuments",
                column: "DepartmentId",
                principalTable: "Departments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Categories_Departments_DepartmentId",
                table: "Categories");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesDocuments_Departments_DepartmentId",
                table: "SalesDocuments");

            migrationBuilder.DropTable(
                name: "Departments");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_DepartmentId",
                table: "SalesDocuments");

            migrationBuilder.DropIndex(
                name: "IX_Categories_DepartmentId",
                table: "Categories");

            migrationBuilder.DropColumn(
                name: "DepartmentIds",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "MaxDiscountPercent",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "DepartmentId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "MaxDiscountPercent",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "DepartmentId",
                table: "Categories");
        }
    }
}
