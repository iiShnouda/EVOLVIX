using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SKB.Api.Migrations
{
    /// <inheritdoc />
    public partial class Payroll : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "MissingAttendanceIsAbsent",
                table: "CompanySettings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "OvertimePercent",
                table: "CompanySettings",
                type: "integer",
                nullable: false,
                defaultValue: 150); // existing companies: time and a half

            migrationBuilder.AddColumn<int>(
                name: "PayrollDayBasis",
                table: "CompanySettings",
                type: "integer",
                nullable: false,
                defaultValue: 30); // a day is 1/30 of the month

            migrationBuilder.CreateTable(
                name: "PayrollRuns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "text", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Earned = table.Column<long>(type: "bigint", nullable: false),
                    Recovered = table.Column<long>(type: "bigint", nullable: false),
                    Net = table.Column<long>(type: "bigint", nullable: false),
                    Paid = table.Column<long>(type: "bigint", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PostedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PostedById = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayrollRuns_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayrollRuns_Staff_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayrollRuns_Staff_PostedById",
                        column: x => x.PostedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Shifts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    StartMinute = table.Column<int>(type: "integer", nullable: false),
                    EndMinute = table.Column<int>(type: "integer", nullable: false),
                    GraceMinutes = table.Column<int>(type: "integer", nullable: false),
                    DaysOff = table.Column<List<int>>(type: "integer[]", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Shifts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Employees",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: false),
                    JobTitle = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    NationalId = table.Column<string>(type: "text", nullable: true),
                    HireDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    MonthlySalary = table.Column<long>(type: "bigint", nullable: false),
                    ShiftId = table.Column<Guid>(type: "uuid", nullable: true),
                    DeviceUserId = table.Column<string>(type: "text", nullable: true),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    AdvanceBalance = table.Column<long>(type: "bigint", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Employees", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Employees_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Employees_Shifts_ShiftId",
                        column: x => x.ShiftId,
                        principalTable: "Shifts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Employees_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AttendanceDays",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CheckIn = table.Column<int>(type: "integer", nullable: true),
                    CheckOut = table.Column<int>(type: "integer", nullable: true),
                    LateMinutes = table.Column<int>(type: "integer", nullable: false),
                    OvertimeMinutes = table.Column<int>(type: "integer", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    UpdatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AttendanceDays", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AttendanceDays_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "EmployeeAdvances",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Number = table.Column<string>(type: "text", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Installment = table.Column<long>(type: "bigint", nullable: false),
                    Remaining = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmployeeAdvances", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmployeeAdvances_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EmployeeAdvances_MoneyAccounts_AccountId",
                        column: x => x.AccountId,
                        principalTable: "MoneyAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EmployeeAdvances_Staff_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayrollAdjustments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<long>(type: "bigint", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    RunId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollAdjustments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayrollAdjustments_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayrollAdjustments_Staff_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayrollLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RunId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeName = table.Column<string>(type: "text", nullable: false),
                    MonthlySalary = table.Column<long>(type: "bigint", nullable: false),
                    EmployedDays = table.Column<int>(type: "integer", nullable: false),
                    WorkDays = table.Column<int>(type: "integer", nullable: false),
                    AbsentDays = table.Column<int>(type: "integer", nullable: false),
                    LateMinutes = table.Column<int>(type: "integer", nullable: false),
                    OvertimeMinutes = table.Column<int>(type: "integer", nullable: false),
                    Basic = table.Column<long>(type: "bigint", nullable: false),
                    OvertimePay = table.Column<long>(type: "bigint", nullable: false),
                    Bonuses = table.Column<long>(type: "bigint", nullable: false),
                    AbsenceDeduction = table.Column<long>(type: "bigint", nullable: false),
                    LateDeduction = table.Column<long>(type: "bigint", nullable: false),
                    Deductions = table.Column<long>(type: "bigint", nullable: false),
                    Earned = table.Column<long>(type: "bigint", nullable: false),
                    AdvanceRecovery = table.Column<long>(type: "bigint", nullable: false),
                    Net = table.Column<long>(type: "bigint", nullable: false),
                    PaidAmount = table.Column<long>(type: "bigint", nullable: false),
                    PaidAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PaidAccountId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayrollLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayrollLines_Employees_EmployeeId",
                        column: x => x.EmployeeId,
                        principalTable: "Employees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayrollLines_PayrollRuns_RunId",
                        column: x => x.RunId,
                        principalTable: "PayrollRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AttendanceDays_EmployeeId_Date",
                table: "AttendanceDays",
                columns: new[] { "EmployeeId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeAdvances_AccountId",
                table: "EmployeeAdvances",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeAdvances_CreatedById",
                table: "EmployeeAdvances",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeAdvances_EmployeeId",
                table: "EmployeeAdvances",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_EmployeeAdvances_Number",
                table: "EmployeeAdvances",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Employees_BranchId",
                table: "Employees",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_Employees_Code",
                table: "Employees",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Employees_DeviceUserId",
                table: "Employees",
                column: "DeviceUserId",
                unique: true,
                filter: "\"DeviceUserId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Employees_ShiftId",
                table: "Employees",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_Employees_StaffId",
                table: "Employees",
                column: "StaffId");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollAdjustments_CreatedById",
                table: "PayrollAdjustments",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollAdjustments_EmployeeId",
                table: "PayrollAdjustments",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollAdjustments_Year_Month",
                table: "PayrollAdjustments",
                columns: new[] { "Year", "Month" });

            migrationBuilder.CreateIndex(
                name: "IX_PayrollLines_EmployeeId",
                table: "PayrollLines",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollLines_RunId_EmployeeId",
                table: "PayrollLines",
                columns: new[] { "RunId", "EmployeeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayrollRuns_BranchId",
                table: "PayrollRuns",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollRuns_CreatedById",
                table: "PayrollRuns",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollRuns_Number",
                table: "PayrollRuns",
                column: "Number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayrollRuns_PostedById",
                table: "PayrollRuns",
                column: "PostedById");

            migrationBuilder.CreateIndex(
                name: "IX_PayrollRuns_Year_Month",
                table: "PayrollRuns",
                columns: new[] { "Year", "Month" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AttendanceDays");

            migrationBuilder.DropTable(
                name: "EmployeeAdvances");

            migrationBuilder.DropTable(
                name: "PayrollAdjustments");

            migrationBuilder.DropTable(
                name: "PayrollLines");

            migrationBuilder.DropTable(
                name: "Employees");

            migrationBuilder.DropTable(
                name: "PayrollRuns");

            migrationBuilder.DropTable(
                name: "Shifts");

            migrationBuilder.DropColumn(
                name: "MissingAttendanceIsAbsent",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "OvertimePercent",
                table: "CompanySettings");

            migrationBuilder.DropColumn(
                name: "PayrollDayBasis",
                table: "CompanySettings");
        }
    }
}
