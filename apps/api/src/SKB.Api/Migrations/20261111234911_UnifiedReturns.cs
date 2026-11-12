using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <summary>
    /// Returns made one way (owner, 2026-11-10): every return line takes its share of the invoice line
    /// it came from, with its share of that invoice's tax; old lines typed apart are marked; the
    /// permission to return without an invoice is folded into the one to return.
    /// </summary>
    public partial class UnifiedReturns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "PricedApart",
                table: "DocumentLines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "Tax",
                table: "DocumentLines",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            // Old returns typed without an invoice priced their lines apart from the invoice lines they
            // took pieces of; every return line now takes its exact share of one.
            migrationBuilder.Sql("""
                UPDATE "DocumentLines" l SET "PricedApart" = true
                FROM "SalesDocuments" d
                WHERE d."Id" = l."DocumentId" AND d."Type" IN ('SALES_RETURN', 'PURCHASE_RETURN')
                  AND d."SourceDocumentId" IS NULL AND l."SourceLineId" IS NOT NULL;
                """);
            // Each return line's share of its return's tax (the last line takes what rounding leaves).
            migrationBuilder.Sql("""
                WITH r AS (
                    SELECT l."Id", l."DocumentId", d."TaxTotal",
                           l."LineTotal" - l."DocDiscount" AS taxable,
                           SUM(l."LineTotal" - l."DocDiscount") OVER (PARTITION BY l."DocumentId") AS total,
                           ROW_NUMBER() OVER (PARTITION BY l."DocumentId" ORDER BY l."LineNo" DESC, l."Id") AS rn
                    FROM "DocumentLines" l JOIN "SalesDocuments" d ON d."Id" = l."DocumentId"
                    WHERE d."Type" IN ('SALES_RETURN', 'PURCHASE_RETURN') AND d."TaxTotal" <> 0
                ), s AS (
                    SELECT "Id", "DocumentId", "TaxTotal", rn,
                           CASE WHEN total = 0 THEN 0 ELSE ROUND("TaxTotal"::numeric * taxable / total)::bigint END AS share
                    FROM r
                )
                UPDATE "DocumentLines" l
                SET "Tax" = CASE WHEN s.rn = 1
                    THEN s."TaxTotal" - COALESCE((SELECT SUM(o.share) FROM s o WHERE o."DocumentId" = s."DocumentId" AND o.rn > 1), 0)
                    ELSE s.share END
                FROM s WHERE s."Id" = l."Id";
                """);
            // One way to return (owner, 2026-11-10): whoever could return without an invoice now
            // returns the one way; nobody gains or loses the right to return.
            migrationBuilder.Sql("""
                -- sales:return_free → sales:return
                UPDATE "Staff" s SET "RevokedPermissions" = array_remove(s."RevokedPermissions", 'sales:return')
                WHERE 'sales:return' = ANY(s."RevokedPermissions") AND NOT ('sales:return_free' = ANY(s."RevokedPermissions"))
                  AND ('sales:return_free' = ANY(s."GrantedPermissions")
                       OR EXISTS (SELECT 1 FROM "CustomRoles" c WHERE c."Id" = s."CustomRoleId" AND 'sales:return_free' = ANY(c."Permissions"))
                       OR (s."CustomRoleId" IS NULL AND EXISTS (SELECT 1 FROM "RolePermissionSets" r
                           WHERE r."Role" = s."Role" AND 'sales:return_free' = ANY(r."Permissions")))
                       OR (s."CustomRoleId" IS NULL AND s."Role" IN ('ACCOUNTANT', 'SALES') AND NOT EXISTS (SELECT 1 FROM "RolePermissionSets" r
                           WHERE r."Role" = s."Role")));
                UPDATE "Staff" SET "GrantedPermissions" = ARRAY(SELECT DISTINCT unnest(array_remove("GrantedPermissions", 'sales:return_free') || ARRAY['sales:return']::text[])) WHERE 'sales:return_free' = ANY("GrantedPermissions");
                UPDATE "Staff" SET "RevokedPermissions" = array_remove("RevokedPermissions", 'sales:return_free') WHERE 'sales:return_free' = ANY("RevokedPermissions");
                UPDATE "CustomRoles" SET "Permissions" = ARRAY(SELECT DISTINCT unnest(array_remove("Permissions", 'sales:return_free') || ARRAY['sales:return']::text[])) WHERE 'sales:return_free' = ANY("Permissions");
                UPDATE "RolePermissionSets" SET "Permissions" = ARRAY(SELECT DISTINCT unnest(array_remove("Permissions", 'sales:return_free') || ARRAY['sales:return']::text[])) WHERE 'sales:return_free' = ANY("Permissions");
                -- purchases:return_free → purchases:return
                UPDATE "Staff" s SET "RevokedPermissions" = array_remove(s."RevokedPermissions", 'purchases:return')
                WHERE 'purchases:return' = ANY(s."RevokedPermissions") AND NOT ('purchases:return_free' = ANY(s."RevokedPermissions"))
                  AND ('purchases:return_free' = ANY(s."GrantedPermissions")
                       OR EXISTS (SELECT 1 FROM "CustomRoles" c WHERE c."Id" = s."CustomRoleId" AND 'purchases:return_free' = ANY(c."Permissions"))
                       OR (s."CustomRoleId" IS NULL AND EXISTS (SELECT 1 FROM "RolePermissionSets" r
                           WHERE r."Role" = s."Role" AND 'purchases:return_free' = ANY(r."Permissions")))
                       OR (s."CustomRoleId" IS NULL AND s."Role" IN ('ACCOUNTANT', 'INVENTORY') AND NOT EXISTS (SELECT 1 FROM "RolePermissionSets" r
                           WHERE r."Role" = s."Role")));
                UPDATE "Staff" SET "GrantedPermissions" = ARRAY(SELECT DISTINCT unnest(array_remove("GrantedPermissions", 'purchases:return_free') || ARRAY['purchases:return']::text[])) WHERE 'purchases:return_free' = ANY("GrantedPermissions");
                UPDATE "Staff" SET "RevokedPermissions" = array_remove("RevokedPermissions", 'purchases:return_free') WHERE 'purchases:return_free' = ANY("RevokedPermissions");
                UPDATE "CustomRoles" SET "Permissions" = ARRAY(SELECT DISTINCT unnest(array_remove("Permissions", 'purchases:return_free') || ARRAY['purchases:return']::text[])) WHERE 'purchases:return_free' = ANY("Permissions");
                UPDATE "RolePermissionSets" SET "Permissions" = ARRAY(SELECT DISTINCT unnest(array_remove("Permissions", 'purchases:return_free') || ARRAY['purchases:return']::text[])) WHERE 'purchases:return_free' = ANY("Permissions");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PricedApart",
                table: "DocumentLines");

            migrationBuilder.DropColumn(
                name: "Tax",
                table: "DocumentLines");
        }
    }
}
