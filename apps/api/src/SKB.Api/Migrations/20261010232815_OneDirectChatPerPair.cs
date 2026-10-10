using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class OneDirectChatPerPair : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DirectKey",
                table: "ChatConversations",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            // One conversation per two people (owner, 2026-10-10): any second conversation between
            // the same pair gives its messages to the first one and goes.
            migrationBuilder.Sql("""
                CREATE TEMP TABLE direct_pairs AS
                SELECT c."Id", c."CreatedAt",
                       (SELECT string_agg(m."StaffId"::text, ':' ORDER BY m."StaffId"::text COLLATE "C")
                        FROM "ChatMembers" m WHERE m."ConversationId" = c."Id") AS pair
                FROM "ChatConversations" c WHERE c."Kind" = 'DIRECT';
                CREATE TEMP TABLE direct_keep AS
                SELECT DISTINCT ON (pair) pair, "Id" AS keep FROM direct_pairs WHERE pair IS NOT NULL
                ORDER BY pair, "CreatedAt", "Id";
                UPDATE "ChatMessages" msg SET "ConversationId" = k.keep
                FROM direct_pairs p JOIN direct_keep k ON k.pair = p.pair
                WHERE msg."ConversationId" = p."Id" AND p."Id" <> k.keep;
                UPDATE "ChatConversations" c SET "LastMessageAt" = x.last
                FROM (SELECT k.keep, max(c2."LastMessageAt") AS last FROM direct_pairs p
                      JOIN direct_keep k ON k.pair = p.pair JOIN "ChatConversations" c2 ON c2."Id" = p."Id"
                      GROUP BY k.keep) x
                WHERE c."Id" = x.keep;
                DELETE FROM "ChatMembers" WHERE "ConversationId" IN
                  (SELECT p."Id" FROM direct_pairs p JOIN direct_keep k ON k.pair = p.pair WHERE p."Id" <> k.keep);
                DELETE FROM "ChatConversations" WHERE "Id" IN
                  (SELECT p."Id" FROM direct_pairs p JOIN direct_keep k ON k.pair = p.pair WHERE p."Id" <> k.keep);
                UPDATE "ChatConversations" c SET "DirectKey" = k.pair FROM direct_keep k WHERE c."Id" = k.keep;
                DROP TABLE direct_pairs;
                DROP TABLE direct_keep;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_ChatConversations_DirectKey",
                table: "ChatConversations",
                column: "DirectKey",
                unique: true,
                filter: "\"DirectKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ChatConversations_DirectKey",
                table: "ChatConversations");

            migrationBuilder.DropColumn(
                name: "DirectKey",
                table: "ChatConversations");
        }
    }
}
