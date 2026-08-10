
/**
 * Date Extraction Utility
 * Robust functions to find and extract YYYY-MM-DD dates from file names and raw file contents.
 */

/**
 * Extracts a date formatted as YYYY-MM-DD from a filename.
 * Supports various formats:
 * - Screenshot_2026-05-13_044751.png -> 2026-05-13
 * - 12-May-2026.docx -> 2026-05-12
 * - Newsletter_12_05_2026.pdf -> 2026-05-12
 * - May-13-2026.xlsx -> 2026-05-13
 */
export function extractDateFromFilename(fileName: string): string | null {
  if (!fileName) return null;

  const name = fileName.trim();

  // Pattern 1: YYYY-MM-DD or YYYY_MM_DD or YYYY.MM.DD (e.g. 2026-05-13)
  const ymdRegex = /\b(20\d{2})[-_.\/\s](0[1-9]|1[0-2])[-_.\/\s](0[1-9]|[12]\d|3[01])\b/;
  const ymdMatch = name.match(ymdRegex);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  // Pattern 2: DD-MM-YYYY or DD_MM_YYYY or DD.MM.YYYY (e.g. 13-05-2026)
  const dmyRegex = /\b(0?[1-9]|[12]\d|3[01])[-_.\/\s](0?[1-9]|1[0-2])[-_.\/\s](20\d{2})\b/;
  const dmyMatch = name.match(dmyRegex);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  // Months map for verbal month cases
  const monthsMap: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12'
  };

  // Pattern 3: DD-MMM-YYYY or DD MMM YYYY or DD_MMM_YYYY (e.g. 13-May-2026, 13 May 2026)
  const dmyVerboseRegex = /\b(0?[1-9]|[12]\d|3[01])[-_.\/\s]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-_.\/\s]+(20\d{2})\b/i;
  const dmyVerboseMatch = name.match(dmyVerboseRegex);
  if (dmyVerboseMatch) {
    const day = dmyVerboseMatch[1].padStart(2, '0');
    const monthName = dmyVerboseMatch[2].toLowerCase();
    const month = monthsMap[monthName] || '01';
    const year = dmyVerboseMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Pattern 4: MMM-DD-YYYY or MMM DD YYYY (e.g. May-13-2026, May 13 2026)
  const mdyVerboseRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-_.\/\s]+(0?[1-9]|[12]\d|3[01])[-_.\/\s]+(20\d{2})\b/i;
  const mdyVerboseMatch = name.match(mdyVerboseRegex);
  if (mdyVerboseMatch) {
    const monthName = mdyVerboseMatch[1].toLowerCase();
    const month = monthsMap[monthName] || '01';
    const day = mdyVerboseMatch[2].padStart(2, '0');
    const year = mdyVerboseMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Extracts a date formatted as YYYY-MM-DD from the raw file contents/text.
 * Useful when searching for subject headers (e.g. "News - 12 May 2026", "Petrol prices today, May 12, 2026", etc.)
 */
export function extractDateFromRawText(text: string): string | null {
  if (!text) return null;

  const monthsMap: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12'
  };

  // 1. Look for "Month DD, YYYY" or "Month DD YYYY" (e.g. May 12, 2026)
  const mdyRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-\s,]+(0?[1-9]|[12]\d|3[01])[-\s,]+(20\d{2})\b/i;
  const mdyMatch = text.match(mdyRegex);
  if (mdyMatch) {
    const monthName = mdyMatch[1].toLowerCase();
    const month = monthsMap[monthName] || '01';
    const day = mdyMatch[2].padStart(2, '0');
    const year = mdyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // 2. Look for "DD Month YYYY" (e.g. 12 May 2026)
  const dmyRegex = /\b(0?[1-9]|[12]\d|3[01])[-\s,]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-\s,]+(20\d{2})\b/i;
  const dmyMatch = text.match(dmyRegex);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const monthName = dmyMatch[2].toLowerCase();
    const month = monthsMap[monthName] || '01';
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // 3. Look for "YYYY-MM-DD"
  const ymdRegex = /\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/;
  const ymdMatch = text.match(ymdRegex);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  // 4. Look for "DD-MM-YYYY"
  const dmyNumericRegex = /\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](20\d{2})\b/;
  const dmyNumericMatch = text.match(dmyNumericRegex);
  if (dmyNumericMatch) {
    return `${dmyNumericMatch[3]}-${dmyNumericMatch[2].padStart(2, '0')}-${dmyNumericMatch[1].padStart(2, '0')}`;
  }

  return null;
}

/**
 * High-reliability multi-stage date detection.
 * Priority:
 * 1. Checks file name
 * 2. Checks raw content / text in the file (subject lines, headers, body)
 * 3. Falls back to today's date
 */
export function detectFileDate(fileName: string, rawText?: string): string {
  const parsedFilenameDate = extractDateFromFilename(fileName);
  if (parsedFilenameDate) {
    console.log(`[Date Extraction] Found date in filename "${fileName}": ${parsedFilenameDate}`);
    return parsedFilenameDate;
  }

  if (rawText) {
    const parsedTextDate = extractDateFromRawText(rawText);
    if (parsedTextDate) {
      console.log(`[Date Extraction] Found date in file text header: ${parsedTextDate}`);
      return parsedTextDate;
    }
  }

  // Fallback to current date
  const today = new Date().toISOString().split('T')[0];
  console.log(`[Date Extraction] No date found in filename or text. Falling back to today's date: ${today}`);
  return today;
}

/**
 * Converts formatted dates (YYYY-MM-DD or similar) into the clean "D-MMM" format.
 * Examples:
 * - "2026-05-12" -> "12-May"
 * - "2026-05-09" -> "9-May"
 * - "2026-01-01" -> "1-Jan"
 */
export function formatToDMMM(dateStr: string): string {
  if (!dateStr) return "";

  // If already in D-MMM style, return it
  if (/^\d{1,2}-[a-zA-Z]{3}$/.test(dateStr)) {
    return dateStr;
  }

  // Try parsing YYYY-MM-DD
  let year = NaN, month = NaN, day = NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const parts = dateStr.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    // Attempt standard JS Date parsing
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear();
      month = d.getMonth() + 1;
      day = d.getDate();
    }
  }

  if (isNaN(month) || isNaN(day)) {
    return dateStr;
  }

  const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = monthsShort[month - 1] || "Jan";

  return `${day}-${monthName}`;
}
