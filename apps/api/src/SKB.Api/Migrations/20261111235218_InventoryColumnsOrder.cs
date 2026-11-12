using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class InventoryColumnsOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The item list's columns (owner, 2026-11-10): the supplier's code and name first, then the
            // item's code and name ("Products" became "Item name"). Columns are kept by their title in
            // the screen language; whoever put them in an order of their own keeps it, after these four.
            migrationBuilder.Sql("""
                UPDATE "StaffPreferences"
                SET "Value" = replace(replace("Value", '"المنتجات', '"اسم الصنف'), '"Products', '"Item name'),
                    "UpdatedAt" = now()
                WHERE "Key" IN ('columns:inventory.items', 'columns:print:inventory.items', 'columns:width:inventory.items')
                  AND ("Value" LIKE '%"المنتجات%' OR "Value" LIKE '%"Products%');

                UPDATE "StaffPreferences" p
                SET "Value" = (
                        SELECT json_agg(x.v ORDER BY x.o)::text
                        FROM (
                            SELECT h.v, h.o
                            FROM unnest(CASE WHEN p."Value" ~ '[ء-ي]'
                                             THEN ARRAY['كود المورد', 'المورد', 'كود الصنف', 'اسم الصنف']
                                             ELSE ARRAY['Supplier code', 'Supplier', 'Item code', 'Item name'] END)
                                 WITH ORDINALITY AS h(v, o)
                            UNION ALL
                            SELECT e.v, 100 + e.o
                            FROM json_array_elements_text(p."Value"::json) WITH ORDINALITY AS e(v, o)
                            WHERE e.v NOT IN ('كود المورد', 'المورد', 'كود الصنف', 'اسم الصنف', 'المنتجات',
                                              'Supplier code', 'Supplier', 'Item code', 'Item name', 'Products')
                        ) x),
                    "UpdatedAt" = now()
                WHERE p."Key" = 'columns:order:inventory.items' AND p."Value" LIKE '[%';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Nothing to undo: the saved orders stay as they are.
        }
    }
}
