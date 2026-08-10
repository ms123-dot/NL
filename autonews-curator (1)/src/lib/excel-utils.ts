import * as XLSX from 'xlsx';
import { NewsItem } from './types';
import { formatToDMMM } from './date-utils';

export function exportToExcel(items: NewsItem[], dateRange: string) {
  // Sort items by date ascending, then category
  const sortedItems = [...items].sort((a, b) => {
    const dA = new Date(a.date).getTime();
    const dB = new Date(b.date).getTime();
    const dateComp = (isNaN(dA) ? 0 : dA) - (isNaN(dB) ? 0 : dB);
    if (dateComp !== 0) return dateComp;
    return a.category.localeCompare(b.category);
  });

  // Prepare data rows
  // Column B: Date, C: Category, D: News, E: Side, F: Remark
  // A is blank
  const rows = sortedItems.map(item => {
    const formattedDate = formatToDMMM(item.date);

    return [
      null, // A
      formattedDate, // B: Date (e.g. "9-May" or "13-May")
      item.category, // C
      item.news,     // D
      item.side,     // E
      item.remark    // F
    ];
  });

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet([
    [null, null, null, null, null, null], // Row 1 blank
    [null, 'Date', 'Category', 'News', 'Side', 'Remark'], // Row 2 Headers
    ...rows
  ]);

  // Set column widths
  ws['!cols'] = [
    { wch: 5 },  // A
    { wch: 15 }, // B: Date
    { wch: 15 }, // C: Category
    { wch: 60 }, // D: News
    { wch: 5 },  // E: Side
    { wch: 20 }  // F: Remark
  ];

  // Set cell format for Date column
  // We need to find all cells in column B (from row 3 onwards) and make sure they are treated as string/text cells
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:F' + (rows.length + 2));
  for (let R = 2; R <= range.e.r; ++R) {
    const cellRef = XLSX.utils.encode_cell({ r: R, c: 1 });
    if (ws[cellRef]) {
      ws[cellRef].t = 's'; // Force to string to prevent any Excel conversion errors (guarantees literal "9-May" style format)
    }
  }

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, dateRange || 'Newsletter');

  // Write file
  const fileName = `Newsletter_${dateRange.replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
