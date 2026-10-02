using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class NoteDetailsPhotos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BroughtBy",
                table: "Notes",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasPhoto",
                table: "Notes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReceivedOn",
                table: "Notes",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NotePhotos",
                columns: table => new
                {
                    NoteId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContentType = table.Column<string>(type: "text", nullable: false),
                    Data = table.Column<byte[]>(type: "bytea", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UploadedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotePhotos", x => x.NoteId);
                    table.ForeignKey(
                        name: "FK_NotePhotos_Notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "Notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Notes_SerialNumber",
                table: "Notes",
                column: "SerialNumber");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NotePhotos");

            migrationBuilder.DropIndex(
                name: "IX_Notes_SerialNumber",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "BroughtBy",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "HasPhoto",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "ReceivedOn",
                table: "Notes");
        }
    }
}
