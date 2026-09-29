using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class DeliveryShipments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CarrierId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeliveryAddress",
                table: "SalesDocuments",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeliveryMethod",
                table: "SalesDocuments",
                type: "text",
                nullable: false,
                defaultValue: "PICKUP"); // every earlier sale was picked up

            migrationBuilder.AddColumn<string>(
                name: "DeliveryStatus",
                table: "SalesDocuments",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DriverId",
                table: "SalesDocuments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "Parties",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CarrierSettlements",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "text", nullable: false),
                    CarrierId = table.Column<Guid>(type: "uuid", nullable: false),
                    CodTotal = table.Column<long>(type: "bigint", nullable: false),
                    Fees = table.Column<long>(type: "bigint", nullable: false),
                    Received = table.Column<long>(type: "bigint", nullable: false),
                    Difference = table.Column<long>(type: "bigint", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarrierSettlements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CarrierSettlements_Parties_CarrierId",
                        column: x => x.CarrierId,
                        principalTable: "Parties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CarrierSettlements_Staff_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Shipments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "text", nullable: false),
                    WaybillNo = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CarrierId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartyId = table.Column<Guid>(type: "uuid", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    CodAmount = table.Column<long>(type: "bigint", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PickedUpAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReturnedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SettlementId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Shipments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Shipments_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_CarrierSettlements_SettlementId",
                        column: x => x.SettlementId,
                        principalTable: "CarrierSettlements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_Parties_CarrierId",
                        column: x => x.CarrierId,
                        principalTable: "Parties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_Parties_PartyId",
                        column: x => x.PartyId,
                        principalTable: "Parties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_Staff_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ShipmentInvoices",
                columns: table => new
                {
                    ShipmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    CodShare = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShipmentInvoices", x => new { x.ShipmentId, x.DocumentId });
                    table.ForeignKey(
                        name: "FK_ShipmentInvoices_SalesDocuments_DocumentId",
                        column: x => x.DocumentId,
                        principalTable: "SalesDocuments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ShipmentInvoices_Shipments_ShipmentId",
                        column: x => x.ShipmentId,
                        principalTable: "Shipments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_CarrierId",
                table: "SalesDocuments",
                column: "CarrierId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_DeliveryMethod_DeliveryStatus",
                table: "SalesDocuments",
                columns: new[] { "DeliveryMethod", "DeliveryStatus" });

            migrationBuilder.CreateIndex(
                name: "IX_SalesDocuments_DriverId",
                table: "SalesDocuments",
                column: "DriverId");

            migrationBuilder.CreateIndex(
                name: "IX_CarrierSettlements_CarrierId",
                table: "CarrierSettlements",
                column: "CarrierId");

            migrationBuilder.CreateIndex(
                name: "IX_CarrierSettlements_CreatedById",
                table: "CarrierSettlements",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_CarrierSettlements_Number",
                table: "CarrierSettlements",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ShipmentInvoices_DocumentId",
                table: "ShipmentInvoices",
                column: "DocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_BranchId",
                table: "Shipments",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CarrierId_Status",
                table: "Shipments",
                columns: new[] { "CarrierId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CreatedById",
                table: "Shipments",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_Number",
                table: "Shipments",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_PartyId",
                table: "Shipments",
                column: "PartyId");

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_SettlementId",
                table: "Shipments",
                column: "SettlementId");

            migrationBuilder.AddForeignKey(
                name: "FK_SalesDocuments_Parties_CarrierId",
                table: "SalesDocuments",
                column: "CarrierId",
                principalTable: "Parties",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesDocuments_Staff_DriverId",
                table: "SalesDocuments",
                column: "DriverId",
                principalTable: "Staff",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SalesDocuments_Parties_CarrierId",
                table: "SalesDocuments");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesDocuments_Staff_DriverId",
                table: "SalesDocuments");

            migrationBuilder.DropTable(
                name: "ShipmentInvoices");

            migrationBuilder.DropTable(
                name: "Shipments");

            migrationBuilder.DropTable(
                name: "CarrierSettlements");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_CarrierId",
                table: "SalesDocuments");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_DeliveryMethod_DeliveryStatus",
                table: "SalesDocuments");

            migrationBuilder.DropIndex(
                name: "IX_SalesDocuments_DriverId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "CarrierId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "DeliveryAddress",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "DeliveryMethod",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "DeliveryStatus",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "DriverId",
                table: "SalesDocuments");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "Parties");
        }
    }
}
