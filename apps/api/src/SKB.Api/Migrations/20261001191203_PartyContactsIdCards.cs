using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class PartyContactsIdCards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ExtraAddress",
                table: "Parties",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExtraAddressLabel",
                table: "Parties",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasIdBack",
                table: "Parties",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "HasIdFront",
                table: "Parties",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<List<string>>(
                name: "OtherPhoneLabels",
                table: "Parties",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'");

            migrationBuilder.AddColumn<string>(
                name: "TempCarrierName",
                table: "Parties",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PartyIdCards",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PartyId = table.Column<Guid>(type: "uuid", nullable: false),
                    Side = table.Column<string>(type: "text", nullable: false),
                    ContentType = table.Column<string>(type: "text", nullable: false),
                    Data = table.Column<byte[]>(type: "bytea", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UploadedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartyIdCards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PartyIdCards_Parties_PartyId",
                        column: x => x.PartyId,
                        principalTable: "Parties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PartyIdCards_PartyId_Side",
                table: "PartyIdCards",
                columns: new[] { "PartyId", "Side" },
                unique: true);

            // Whoever adds customers keeps their ID card photos.
            migrationBuilder.Sql(@"
UPDATE ""RolePermissionSets"" SET ""Permissions"" = array_append(""Permissions"", 'parties:id_cards')
WHERE 'parties:create' = ANY(""Permissions"") AND NOT 'parties:id_cards' = ANY(""Permissions"");
UPDATE ""Staff"" SET ""GrantedPermissions"" = array_append(""GrantedPermissions"", 'parties:id_cards')
WHERE 'parties:create' = ANY(""GrantedPermissions"") AND NOT 'parties:id_cards' = ANY(""GrantedPermissions"");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PartyIdCards");

            migrationBuilder.DropColumn(
                name: "ExtraAddress",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "ExtraAddressLabel",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "HasIdBack",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "HasIdFront",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "OtherPhoneLabels",
                table: "Parties");

            migrationBuilder.DropColumn(
                name: "TempCarrierName",
                table: "Parties");
        }
    }
}
