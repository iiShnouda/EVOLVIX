using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class DualDevice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "CurrentDeviceId",
                table: "Staff",
                newName: "CurrentMobileDeviceId");

            migrationBuilder.AddColumn<Guid>(
                name: "CurrentDesktopDeviceId",
                table: "Staff",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "Sessions",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "DESKTOP");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CurrentDesktopDeviceId",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "Sessions");

            migrationBuilder.RenameColumn(
                name: "CurrentMobileDeviceId",
                table: "Staff",
                newName: "CurrentDeviceId");
        }
    }
}
