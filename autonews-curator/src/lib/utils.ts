import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function applyStrictSOPCleaning(text: string): string {
  if (!text) return "";
  
  let cleaned = text;

  // 1. Remove non-printable / BOM / Replacement characters
  cleaned = cleaned.replace(/[\uFFFD\uFEFF]/g, "");

  // 2. Rupee replacements
  cleaned = cleaned
    .replace(/â‚¹/g, "INR")
    .replace(/₹/g, "INR")
    .replace(/\u00E2\u0082\u00B9/g, "INR");

  // 3. Common possessive/apostrophe Mojibake: e.g. companyâ€™s -> company's, Indiaâ€™s -> India's
  cleaned = cleaned
    .replace(/(\w)â€™(\w)/g, "$1'$2")
    .replace(/(\w)\u00E2\u0080\u0099(\w)/g, "$1'$2")
    .replace(/â€™/g, "'")
    .replace(/â€˜/g, "'")
    .replace(/\u00E2\u0080\u0099/g, "'")
    .replace(/\u00E2\u0080\u0098/g, "'");

  // 4. Dashes
  cleaned = cleaned
    .replace(/â€“/g, "-")
    .replace(/â€”/g, "-")
    .replace(/\u00E2\u0080\u0093/g, "-")
    .replace(/\u00E2\u0080\u0094/g, "-");

  // 5. Remove leftover Mojibake quotes / encoding artifacts (e.g. â€œAfter -> After, â€  -> empty, â€[?] -> empty)
  cleaned = cleaned
    .replace(/â€[œ ’‘“”–—…‹\u0153\u2039\u201d\u201c\u2122\u009d\u009c\u0099\u0098\u0093\u0094\u00a0\u0080-\u009f]*/g, "")
    .replace(/\u00E2\u0080[\u0080-\u00BF]*/g, "")
    .replace(/â€/g, "")
    .replace(/â/g, "")
    .replace(/Â/g, "")
    .replace(/Ã/g, "");

  // Remove unprintable control characters (except newline, tab, carriage return)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

  // Rule 1: "Rs." or "Rs " or "Rs" (representing Indian Rupees) -> MUST convert to "INR"
  cleaned = cleaned.replace(/\bRs\.?\s*(\d)/gi, "INR $1");
  cleaned = cleaned.replace(/\bRs\b/gi, "INR");
  cleaned = cleaned.replace(/\bRs\./gi, "INR");

  // Rule 2: "Percent" or "Percentage" or "percent" -> MUST be replaced with "%" exactly
  cleaned = cleaned.replace(/\bpercentages?\b/gi, "%");
  cleaned = cleaned.replace(/\bpercent\b/gi, "%");

  // Rule 3: "$" -> MUST be converted to "US$" exactly (avoiding converting "US$" to "USUS$")
  cleaned = cleaned.replace(/\bUS\s*US\s*\$/gi, "US$");
  cleaned = cleaned.replace(/\bUS\s*\$/gi, "US$");
  cleaned = cleaned.replace(/\bU\.S\.\s*\$/gi, "US$");
  cleaned = cleaned.replace(/\bUSD\b/gi, "US$");
  cleaned = cleaned.replace(/(?<!US)\$/g, "US$");

  // Rule 4: "Million" or "mln" or "million" -> MUST be replaced with "Mn."
  cleaned = cleaned.replace(/\b(?:millions?|mln)\b/gi, "Mn.");

  // Rule 5: "Billion" or "bln" or "billion" -> MUST be replaced with "Bn."
  cleaned = cleaned.replace(/\b(?:billions?|bln)\b/gi, "Bn.");

  // Rule 6: "Crore" or "crores" or "crore" -> MUST be replaced with "Cr."
  cleaned = cleaned.replace(/\bcrores?\b/gi, "Cr.");

  // Rule 7: "Year on Year" or "YoY" or "Yo-Y" or "year-on-year" -> MUST be replaced with "Y-o-Y"
  cleaned = cleaned.replace(/\b(?:year[- ]on[- ]year)\b/gi, "Y-o-Y");
  cleaned = cleaned.replace(/\bYo[-]?Y\b/gi, "Y-o-Y");

  // Clean double-period artifacts created by raw text replacements (e.g. "million." -> "Mn..")
  cleaned = cleaned.replace(/Mn\.\./gi, "Mn.");
  cleaned = cleaned.replace(/Bn\.\./gi, "Bn.");
  cleaned = cleaned.replace(/Cr\.\./gi, "Cr.");

  // Clean double spaces
  cleaned = cleaned.replace(/[ \t]+/g, " ");

  // 8. Filter out recommended article lines / website widgets and arrowhead-led recommended headlines
  const lines = cleaned.split(/\r?\n/);
  const filteredLines = lines.filter(line => {
    const t = line.trim();
    if (!t) return true; // Keep empty lines for spacing

    const lowercaseT = t.toLowerCase();

    // Phrases that indicate website recommendation widgets, "Also Read", etc.
    const isRelatedArticleWidget = 
      lowercaseT.startsWith("also read:") ||
      lowercaseT.startsWith("read also:") ||
      lowercaseT.startsWith("read more:") ||
      lowercaseT.startsWith("also check:") ||
      lowercaseT.startsWith("related news:") ||
      lowercaseT.startsWith("related articles:") ||
      lowercaseT.startsWith("related stories:") ||
      lowercaseT.startsWith("related story:") ||
      lowercaseT.startsWith("must read:") ||
      lowercaseT.startsWith("more from") ||
      lowercaseT.startsWith("click here") ||
      lowercaseT.startsWith("subscribe to") ||
      lowercaseT.startsWith("follow us on") ||
      lowercaseT.startsWith("join our telegram") ||
      lowercaseT.startsWith("related video:") ||
      lowercaseT.startsWith("recommended for you:") ||
      ((lowercaseT.startsWith("also read") || 
        lowercaseT.startsWith("related news") || 
        lowercaseT.startsWith("related articles") || 
        lowercaseT.startsWith("more from")) && t.length < 35);

    if (isRelatedArticleWidget) {
      return false;
    }

    // Check for bullet/arrowhead recommended headlines (like ►, ▶, etc.)
    // These specific characters are never used to begin actual editorial paragraphs.
    const startsWithArrowhead = /^[►▶▶️▲▼■◆❖◾◼➢➤◄◀]\s*/.test(t);
    if (startsWithArrowhead) {
      return false;
    }

    // General bullets like • or * or - are skipped if they look like a headline (short and no period at end)
    const startsWithGeneralBullet = /^[•*%-]\s*/.test(t);
    if (startsWithGeneralBullet && t.length < 180 && !/[.!?]$/.test(t)) {
      return false;
    }

    return true;
  });

  cleaned = filteredLines.join("\n");

  return cleaned.trim();
}

export function formatToDDMMMYYYY_Spaced(dateStr?: string): string {
  if (!dateStr) return "29 Jun 2026";
  
  let clean = dateStr.trim().replace(/^(Date:\s*)/i, "");
  
  // Replace hyphens or slashes with spaces to aid standard parsing
  const cleanWithSpaces = clean.replace(/[-/]/g, " ");
  const d = new Date(cleanWithSpaces);
  
  if (isNaN(d.getTime())) {
    const regex = /(\d{1,2})[-/\s]+([A-Za-z]{3,10})[-/\s]+(\d{4})/;
    const match = clean.match(regex);
    if (match) {
      const day = match[1].padStart(2, '0');
      let m = match[2].slice(0, 3);
      m = m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
      const yr = match[3];
      return `${day} ${m} ${yr}`;
    }
    return clean;
  }
  
  const day = String(d.getDate()).padStart(2, '0');
  const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = monthsShort[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${monthName} ${year}`;
}

export function formatSourceName(sourceName?: string): string {
  if (!sourceName) return "ET Auto";
  const normalized = sourceName.trim().replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();

  if (
    lower.includes("economic times") || 
    lower.includes("economics times") || 
    lower.includes("economictimes") ||
    lower === "et" ||
    lower === "et auto"
  ) {
    return "ET Auto";
  }

  if (
    lower.includes("hindu business") || 
    lower.includes("the hindu business") || 
    lower.includes("hindu business line") ||
    lower.includes("the hindu business line") ||
    lower.includes("the hindu business lines") ||
    lower.includes("the hindu") ||
    lower === "the hindu"
  ) {
    return "The Hindu";
  }

  return normalized;
}


