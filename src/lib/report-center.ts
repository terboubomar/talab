import { supabase } from "@/lib/supabase";

export type DriverReportRow = {
  driver_id: string;
  driver_name: string;
  orders: number;
  sales: number;
  last_delivery_at: string | null;
};

export type CustomerReportRow = {
  customer_id: string;
  name: string;
  phone: string;
  orders: number;
  sales: number;
  average_order_value: number;
  last_order_at: string | null;
};

export type LedgerSummary = {
  movements: number;
  credits?: number;
  debits?: number;
  awarded?: number;
  redeemed?: number;
  net: number;
};

export type ReportCenterSupport = {
  drivers: DriverReportRow[];
  customers: CustomerReportRow[];
  wallet_summary: LedgerSummary;
  wallet_by_day: Array<{ day: string; credits: number; debits: number; movements: number }>;
  points_summary: LedgerSummary;
  points_by_day: Array<{ day: string; awarded: number; redeemed: number; movements: number }>;
  ledger_branch_filter_applies: boolean;
};

export type SalesDetailOrder = {
  id: string;
  placed_at: string;
  branch_name: string;
  customer_name: string;
  customer_phone: string;
  order_type: string;
  status: string;
  source: string;
  agent_name: string | null;
  payment_method: string;
  payment_status: string;
  subtotal: number;
  discount_total: number;
  delivery_fee: number;
  tax_total: number;
  total: number;
};

export type SalesDetailReport = {
  total_rows: number;
  truncated: boolean;
  by_source: Array<{ source: string; orders: number; completed_orders: number; sales: number }>;
  by_payment_method: Array<{ payment_method: string; orders: number; completed_orders: number; sales: number }>;
  orders: SalesDetailOrder[];
};

export type ExcelCellValue = string | number | null | undefined;
export type ExcelRow = Record<string, ExcelCellValue>;
export type ExcelSheet = {
  name: string;
  rows: ExcelRow[];
};

export async function fetchReportCenterSupport(from: string, to: string, branchId?: string | null): Promise<ReportCenterSupport> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_report_center_support", {
    p_from: from,
    p_to: to,
    p_branch_id: branchId || null,
  });
  if (error) throw error;
  return data as ReportCenterSupport;
}

export async function fetchSalesDetailReport(from: string, to: string, branchId?: string | null): Promise<SalesDetailReport> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_sales_detail_report", {
    p_from: from,
    p_to: to,
    p_branch_id: branchId || null,
  });
  if (error) throw error;
  return data as SalesDetailReport;
}

export function downloadCsv(filename: string, rows: ExcelRow[]) {
  if (typeof window === "undefined" || rows.length === 0) return;
  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = `\uFEFF${headers.map(escape).join(",")}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export function downloadExcel(filename: string, rows: ExcelRow[], sheetName = "التقرير") {
  downloadExcelWorkbook(filename, [{ name: sheetName, rows }]);
}

export function downloadExcelWorkbook(filename: string, sheets: ExcelSheet[]) {
  if (typeof window === "undefined") return;
  const usableSheets = sheets.filter((sheet) => sheet.rows.length > 0);
  if (usableSheets.length === 0) return;

  const usedNames = new Set<string>();
  const worksheets = usableSheets.map((sheet, index) => {
    const name = uniqueSheetName(sheet.name || `Sheet ${index + 1}`, usedNames);
    const headers = Object.keys(sheet.rows[0] ?? {});
    const widths = headers.map((header) => {
      const maxLength = Math.max(
        stringWidth(header),
        ...sheet.rows.slice(0, 500).map((row) => stringWidth(row[header])),
      );
      return Math.min(240, Math.max(75, maxLength * 7.5 + 20));
    });

    const columns = widths.map((width) => `<Column ss:AutoFitWidth="0" ss:Width="${width.toFixed(0)}"/>`).join("");
    const headerRow = `<Row ss:StyleID="Header">${headers.map((header) => excelCell(header, true)).join("")}</Row>`;
    const bodyRows = sheet.rows.map((row) => `<Row>${headers.map((header) => excelCell(row[header], false)).join("")}</Row>`).join("");

    return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${columns}${headerRow}${bodyRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions></Worksheet>`;
  }).join("");

  const workbook = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Author>TALAB</Author><Created>${new Date().toISOString()}</Created></DocumentProperties><ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel"><ProtectStructure>False</ProtectStructure><ProtectWindows>False</ProtectWindows></ExcelWorkbook><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/><Borders/><Font ss:FontName="Arial" ss:Size="10"/><Interior/><NumberFormat/><Protection/></Style><Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#E9EEF5" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style><Style ss:ID="Number"><Alignment ss:Vertical="Center"/><NumberFormat ss:Format="#,##0.00"/></Style></Styles>${worksheets}</Workbook>`;

  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const safeName = filename.replace(/\.(xls|xlsx|xml)$/i, "");
  triggerDownload(blob, `${safeName}.xml`);
}

function excelCell(value: ExcelCellValue, header: boolean) {
  if (!header && typeof value === "number" && Number.isFinite(value)) {
    return `<Cell ss:StyleID="Number"><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell${header ? ' ss:StyleID="Header"' : ""}><Data ss:Type="String">${escapeXml(value ?? "")}</Data></Cell>`;
}

function uniqueSheetName(input: string, used: Set<string>) {
  const base = input.replace(/[\\/*?:\[\]]/g, " ").trim().slice(0, 31) || "Report";
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    const marker = ` ${suffix}`;
    name = `${base.slice(0, 31 - marker.length)}${marker}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function stringWidth(value: unknown) {
  return Array.from(String(value ?? "")).reduce((total, character) => total + (/[\u0600-\u06FF]/.test(character) ? 1.35 : 1), 0);
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
