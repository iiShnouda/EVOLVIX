using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class MoneyVouchers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PaidAccountId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AccountId",
                table: "CarrierSettlements",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ExpenseCategories",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExpenseCategories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ExpenseCategories_ExpenseCategories_ParentId",
                        column: x => x.ParentId,
                        principalTable: "ExpenseCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MoneyAccounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustodianId = table.Column<Guid>(type: "uuid", nullable: true),
                    Number = table.Column<string>(type: "text", nullable: true),
                    BankName = table.Column<string>(type: "text", nullable: true),
                    Balance = table.Column<long>(type: "bigint", nullable: false),
                    LastSeq = table.Column<long>(type: "bigint", nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MoneyAccounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MoneyAccounts_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MoneyAccounts_Staff_CustodianId",
                        column: x => x.CustodianId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Vouchers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartyId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExpenseCategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    FromAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    ToAccountId = table.Column<Guid>(type: "uuid", nullable: true),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CancelledById = table.Column<Guid>(type: "uuid", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Vouchers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Vouchers_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Vouchers_ExpenseCategories_ExpenseCategoryId",
                        column: x => x.ExpenseCategoryId,
                        principalTable: "ExpenseCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Vouchers_MoneyAccounts_FromAccountId",
                        column: x => x.FromAccountId,
                        principalTable: "MoneyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Vouchers_MoneyAccounts_ToAccountId",
                        column: x => x.ToAccountId,
                        principalTable: "MoneyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Vouchers_Parties_PartyId",
                        column: x => x.PartyId,
                        principalTable: "Parties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Vouchers_Staff_CancelledById",
                        column: x => x.CancelledById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Vouchers_Staff_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MoneyMovements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Seq = table.Column<long>(type: "bigint", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    BalanceAfter = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Method = table.Column<string>(type: "text", nullable: true),
                    VoucherId = table.Column<Guid>(type: "uuid", nullable: true),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: true),
                    SettlementId = table.Column<Guid>(type: "uuid", nullable: true),
                    PartyId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reference = table.Column<string>(type: "text", nullable: true),
                    MethodReference = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MoneyMovements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MoneyMovements_MoneyAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "MoneyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MoneyMovements_Parties_PartyId",
                        column: x => x.PartyId,
                        principalTable: "Parties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MoneyMovements_Staff_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MoneyMovements_Vouchers_VoucherId",
                        column: x => x.VoucherId,
                        principalTable: "Vouchers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VoucherAllocations",
                columns: table => new
                {
                    VoucherId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoucherAllocations", x => new { x.VoucherId, x.DocumentId });
                    table.ForeignKey(
                        name: "FK_VoucherAllocations_SalesDocuments_DocumentId",
                        column: x => x.DocumentId,
                        principalTable: "SalesDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VoucherAllocations_Vouchers_VoucherId",
                        column: x => x.VoucherId,
                        principalTable: "Vouchers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VoucherLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VoucherId = table.Column<Guid>(type: "uuid", nullable: false),
                    LineNo = table.Column<int>(type: "integer", nullable: false),
                    Method = table.Column<string>(type: "text", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Reference = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoucherLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VoucherLines_MoneyAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "MoneyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VoucherLines_Vouchers_VoucherId",
                        column: x => x.VoucherId,
                        principalTable: "Vouchers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_PaidAccountId",
                table: "SalesDocuments",
                column: "PaidAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_CarrierSettlements_AccountId",
                table: "CarrierSettlements",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_ExpenseCategories_ParentId",
                table: "ExpenseCategories",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_MoneyAccounts_BranchId",
                table: "MoneyAccounts",
                column: "BranchId",
                unique: true,
                filter: "\"IsDefault\"");

            migrationBuilder.CreateIndex(
                name: "IX_MoneyAccounts_CustodianId",
                table: "MoneyAccounts",
                column: "CustodianId");

            migrationBuilder.CreateIndex(
                name: "IX_MoneyMovements_AccountId_CreatedAt",
                table: "MoneyMovements",
                columns: new[] { "AccountId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MoneyMovements_AccountId_Seq",
                table: "MoneyMovements",
                columns: new[] { "AccountId", "Seq" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MoneyMovements_CreatedById",
                table: "MoneyMovements",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_MoneyMovements_DocumentId",
                table: "MoneyMovements",
                column: "DocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_MoneyMovements_PartyId",
                table: "MoneyMovements",
                column: "PartyId");

            migrationBuilder.CreateIndex(
                name: "IX_MoneyMovements_VoucherId",
                table: "MoneyMovements",
                column: "VoucherId");

            migrationBuilder.CreateIndex(
                name: "IX_VoucherAllocations_DocumentId",
                table: "VoucherAllocations",
                column: "DocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_VoucherLines_AccountId",
                table: "VoucherLines",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_VoucherLines_VoucherId",
                table: "VoucherLines",
                column: "VoucherId");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_BranchId",
                table: "Vouchers",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_CancelledById",
                table: "Vouchers",
                column: "CancelledById");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_CreatedById",
                table: "Vouchers",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_ExpenseCategoryId",
                table: "Vouchers",
                column: "ExpenseCategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_FromAccountId",
                table: "Vouchers",
                column: "FromAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_Number",
                table: "Vouchers",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_PartyId",
                table: "Vouchers",
                column: "PartyId");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_ToAccountId",
                table: "Vouchers",
                column: "ToAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_Vouchers_Type_CreatedAt",
                table: "Vouchers",
                columns: new[] { "Type", "CreatedAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_CarrierSettlements_MoneyAccounts_AccountId",
                table: "CarrierSettlements",
                column: "AccountId",
                principalTable: "MoneyAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesDocuments_MoneyAccounts_PaidAccountId",
                table: "SalesDocuments",
                column: "PaidAccountId",
                principalTable: "MoneyAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // Every existing branch gets its default cash box, empty: the owner enters what is in it
            // (an opening balance) on the Money screen. Past paid amounts are not replayed into it.
            migrationBuilder.Sql("""
                INSERT INTO "MoneyAccounts" ("Id", "Name", "Kind", "BranchId", "Balance", "LastSeq", "Currency",
                                             "IsDefault", "IsActive", "CreatedAt")
                SELECT gen_random_uuid(), 'خزينة ' || b."Name", 'CASH_BOX', b."Id", 0, 0,
                       COALESCE((SELECT "Currency" FROM "CompanySettings" LIMIT 1), 'EGP'), true, true, now()
                FROM "Branches" b;
                """);

            // Starter expense categories (names are data, kept as typed; more can be added).
            migrationBuilder.Sql("""
                INSERT INTO "ExpenseCategories" ("Id", "Name", "IsActive")
                SELECT gen_random_uuid(), n, true
                FROM unnest(ARRAY['إيجار', 'كهرباء ومياه وغاز', 'مرتبات وأجور', 'نقل وشحن', 'صيانة وإصلاحات',
                                  'أدوات مكتبية ومطبوعات', 'اتصالات وإنترنت', 'ضيافة', 'رسوم حكومية',
                                  'مصروفات بنكية', 'مصروفات أخرى']) AS n;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CarrierSettlements_MoneyAccounts_AccountId",
                table: "CarrierSettlements");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesDocuments_MoneyAccounts_PaidAccountId",
                table: "SalesDocuments");

            migrationBuilder.DropTable(
                name: "MoneyMovements");

            migrationBuilder.DropTable(
                name: "VoucherAllocations");

            migrationBuilder.DropTable(
                name: "VoucherLines");

            migrationBuilder.DropTable(
                name: "Vouchers");

            migrationBuilder.DropTable(
                name: "ExpenseCategories");

            migrationBuilder.DropTable(
                name: "MoneyAccounts");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_PaidAccountId",
                table: "SalesDocuments");

            migrationBuilder.DropIndex(
                name: "IX_CarrierSettlements_AccountId",
                table: "CarrierSettlements");

            migrationBuilder.DropColumn(
                name: "PaidAccountId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "CarrierSettlements");
        }
    }
}
