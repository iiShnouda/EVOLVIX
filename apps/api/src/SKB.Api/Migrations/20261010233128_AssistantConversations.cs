using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class AssistantConversations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ConversationId",
                table: "AssistantTurns",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "AssistantConversations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssistantConversations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssistantTurns_ConversationId",
                table: "AssistantTurns",
                column: "ConversationId");

            migrationBuilder.CreateIndex(
                name: "IX_AssistantConversations_StaffId_UpdatedAt",
                table: "AssistantConversations",
                columns: new[] { "StaffId", "UpdatedAt" });

            // Each person's earlier questions and answers become their first conversation.
            migrationBuilder.Sql("""
                INSERT INTO "AssistantConversations" ("Id", "StaffId", "Title", "CreatedAt", "UpdatedAt")
                SELECT gen_random_uuid(), t."StaffId",
                       left(regexp_replace(coalesce((SELECT u."Content" FROM "AssistantTurns" u
                            WHERE u."StaffId" = t."StaffId" AND u."Role" = 'user' ORDER BY u."CreatedAt" LIMIT 1), ''),
                            '\s+', ' ', 'g'), 80),
                       min(t."CreatedAt"), max(t."CreatedAt")
                FROM "AssistantTurns" t GROUP BY t."StaffId";
                UPDATE "AssistantTurns" t SET "ConversationId" = c."Id"
                FROM "AssistantConversations" c WHERE c."StaffId" = t."StaffId";
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_AssistantTurns_AssistantConversations_ConversationId",
                table: "AssistantTurns",
                column: "ConversationId",
                principalTable: "AssistantConversations",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_AssistantTurns_AssistantConversations_ConversationId",
                table: "AssistantTurns");

            migrationBuilder.DropTable(
                name: "AssistantConversations");

            migrationBuilder.DropIndex(
                name: "IX_AssistantTurns_ConversationId",
                table: "AssistantTurns");

            migrationBuilder.DropColumn(
                name: "ConversationId",
                table: "AssistantTurns");
        }
    }
}
