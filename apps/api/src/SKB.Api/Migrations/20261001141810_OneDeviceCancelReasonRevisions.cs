using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class OneDeviceCancelReasonRevisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CurrentDeviceId",
                table: "Staff",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeviceId",
                table: "Sessions",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<bool>(
                name: "Remember",
                table: "Sessions",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "RevokedReason",
                table: "Sessions",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CancelReason",
                table: "SalesDocuments",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "InvoiceRevisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    TotalBefore = table.Column<long>(type: "bigint", nullable: false),
                    TotalAfter = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceRevisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InvoiceRevisions_SalesDocuments_DocumentId",
                        column: x => x.DocumentId,
                        principalTable: "SalesDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceRevisions_At",
                table: "InvoiceRevisions",
                column: "At");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceRevisions_DocumentId",
                table: "InvoiceRevisions",
                column: "DocumentId");

            // Owner decision 2026-10-01: the report of cancelled and changed invoices goes to whoever
            // approves sales. Sessions from before stay remembered, as they were.
            migrationBuilder.Sql("""
                UPDATE "RolePermissionSets" SET "Permissions" = array_append("Permissions", 'sales:changes_report')
                WHERE 'sales:approve' = ANY("Permissions") AND NOT 'sales:changes_report' = ANY("Permissions");
                UPDATE "Staff" SET "GrantedPermissions" = array_append("GrantedPermissions", 'sales:changes_report')
                WHERE 'sales:approve' = ANY("GrantedPermissions") AND NOT 'sales:changes_report' = ANY("GrantedPermissions");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InvoiceRevisions");

            migrationBuilder.DropColumn(
                name: "CurrentDeviceId",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "DeviceId",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Remember",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "RevokedReason",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "CancelReason",
                table: "SalesDocuments");
        }
    }
}
