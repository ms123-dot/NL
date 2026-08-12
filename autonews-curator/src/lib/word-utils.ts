import { NewsItem } from "./types";
import { formatToDMMM } from "./date-utils";
import { applyStrictSOPCleaning, formatToDDMMMYYYY_Spaced, formatSourceName } from "./utils";
import { robustFetch } from "./gemini";

interface CompiledItem {
  id: string;
  news: string;
  category: string;
  side: "l" | "r";
  fullText: string;
  sourceLink?: string;
  isEV?: boolean;
  weekday?: string;
  date?: string;
}

export async function extractDetailedNews(
  items: NewsItem[],
  rawText: string,
  forceReextract = false
): Promise<CompiledItem[]> {
  // Ensure every item has an id before sending to the backend and mutate the reference so caller can match by ID
  const itemsWithIds = items.map((item, index) => {
    const assignedId = item.id || `item_${index}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    item.id = assignedId;
    return {
      ...item,
      id: assignedId
    };
  });

  // Separate already-extracted/edited items from items that need extraction
  const alreadyExtracted: CompiledItem[] = [];
  const itemsToExtract: any[] = [];

  itemsWithIds.forEach(item => {
    const hasSubstantialText = item.fullText && item.fullText.trim().length > 120 && item.fullText.trim() !== item.news.trim();
    // If we already have substantial fullText and non-empty sourceLink, keep it unless forceReextract is requested
    if (!forceReextract && hasSubstantialText && item.sourceLink && item.sourceLink.trim() !== "") {
      alreadyExtracted.push({
        id: item.id,
        news: item.news,
        category: item.category,
        side: (item.side === "r" ? "r" : "l"),
        fullText: item.fullText,
        sourceLink: item.sourceLink,
        isEV: item.isEV ?? (item.news.toLowerCase().includes("electric") || item.news.toLowerCase().includes("ev ") || item.category === "Electrification"),
        weekday: item.weekday,
        date: item.date
      });
    } else {
      itemsToExtract.push(item);
    }
  });

  if (itemsToExtract.length === 0) {
    return alreadyExtracted;
  }

  try {
    const response = await robustFetch("/api/extract-detailed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: itemsToExtract,
        rawText,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      let errMsg = `Server extraction failed with status ${response.status}`;
      try {
        const errData = JSON.parse(errText);
        if (errData && errData.error) {
          errMsg = errData.error;
        }
      } catch (e) {
        // Not JSON
        if (errText.includes("<!doctype html>") || errText.includes("<!DOCTYPE html>")) {
          errMsg = `Server returned an HTML error page (status ${response.status}). This can happen if the backend server crashed or is restarting.`;
        } else if (errText) {
          errMsg = errText.slice(0, 200);
        }
      }
      throw new Error(errMsg);
    }

    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Server returned a non-JSON response format (Content-Type: ${contentType}).`);
    }

    const data = await response.json();
    const serverCompiled = data.compiledItems as CompiledItem[];
    
    // Combine both arrays
    return [...alreadyExtracted, ...serverCompiled];
  } catch (error) {
    console.error("Failed to extract detailed news via server-side API:", error);
    // Safe client-side fallback to ensure document compilation always continues gracefully
    const fallbackCompiled = itemsToExtract.map(item => ({
      id: item.id,
      news: item.news,
      category: item.category,
      side: (item.side === "r" ? "r" : "l") as "l" | "r",
      fullText: (item.fullText && item.fullText.trim() !== item.news.trim()) ? item.fullText : "Content not available",
      sourceLink: item.sourceLink || "",
      isEV: item.isEV ?? (item.news.toLowerCase().includes("electric") || item.news.toLowerCase().includes("ev ") || item.category === "Electrification")
    }));
    return [...alreadyExtracted, ...fallbackCompiled];
  }
}

// Helper: Clean encoding artifacts and restore native currency / punctuation marks
function cleanContentText(text: string): string {
  if (!text) return "";
  return applyStrictSOPCleaning(text);
}

// Helper: Extract name of prestigious media publisher from raw URL link
function getSourceName(urlStr?: string): string {
  if (!urlStr) return "ET Auto";
  const url = urlStr.toLowerCase();
  let baseName = "ET Auto";
  if (url.includes("economictimes")) baseName = "ET Auto";
  else if (url.includes("hindustantimes")) baseName = "Hindustan Times";
  else if (url.includes("livemint") || url.includes("mint")) baseName = "Mint";
  else if (url.includes("thehindubusinessline") || url.includes("hindubusinessline")) baseName = "The Hindu";
  else if (url.includes("autocarindia")) baseName = "Autocar India";
  else if (url.includes("thehindu.com")) baseName = "The Hindu";
  else if (url.includes("tribuneindia")) baseName = "The Tribune";
  else if (url.includes("business-standard")) baseName = "Business Standard";
  else {
    try {
      const hostname = new URL(urlStr).hostname.replace("www.", "");
      const parts = hostname.split('.');
      if (parts.length > 1) {
        baseName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      } else {
        baseName = hostname;
      }
    } catch (e) {
      baseName = "ET Auto";
    }
  }
  return formatSourceName(baseName);
}

// Helper: Format date to standard corporate DD MMM YYYY format
function formatToDDMMMYYYY(dateStr?: string): string {
  return formatToDDMMMYYYY_Spaced(dateStr);
}

// Helper: Estimate page occupancy of a specific article to generate accurate Table of Contents
function estimateArticlePageCount(item: CompiledItem): number {
  const textLength = item.fullText?.length || 0;
  if (textLength > 2200) {
    return 2;
  }
  return 1;
}

// Helper: Split raw paragraphs and format body text & subheadings
function renderArticleParagraphs(fullText: string): string {
  if (!fullText || fullText.trim() === "" || fullText === "Content not available") {
    return `<p style="font-family: 'Calibri', sans-serif; font-size: 11pt; text-align: left; line-height: 1.15; margin-top: 0pt; margin-bottom: 8pt; color: #555555; font-style: italic;">Content not available</p>`;
  }
  const cleanedText = cleanContentText(fullText);
  if (!cleanedText || cleanedText.trim() === "") {
    return `<p style="font-family: 'Calibri', sans-serif; font-size: 11pt; text-align: left; line-height: 1.15; margin-top: 0pt; margin-bottom: 8pt; color: #555555; font-style: italic;">Content not available</p>`;
  }
  
  // Split by newlines to preserve the exact line breaks and paragraph structure of the raw files
  const lines = cleanedText.split(/\r?\n/);
  
  let html = "";
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return; // Skip empty lines, spacing is handled by margin-bottom of paragraphs
    
    const isUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://");
    if (isUrl) {
      html += `<p style="font-family: 'Calibri', sans-serif; font-size: 11pt; margin-top: 4pt; margin-bottom: 8pt; text-align: left; color: #000000;">
        ${trimmed}
      </p>`;
    } else {
      html += `<p style="font-family: 'Calibri', sans-serif; font-size: 11pt; text-align: justify; line-height: 1.15; margin-top: 0pt; margin-bottom: 8pt; color: #000000; text-justify: inter-word;">
        ${trimmed}
      </p>`;
    }
  });
  
  return html;
}

export function generateAndDownloadWordDoc(
  compiledItems: CompiledItem[],
  dateRange: string
) {
  // Sort categories strictly as per SOP specification
  const categoriesSOP = [
    "Corporate",
    "Electrification",
    "New Product",
    "Auto Ancillary",
    "Service",
    "Govt",
    "Global"
  ];

  // Map category codes to high-end publication display titles
  const CATEGORY_MAPPINGS: Record<string, string> = {
    "Corporate": "Corporate Strategies and Partnerships",
    "Electrification": "Electrification Updates",
    "New Product": "New Product Launches",
    "Auto Ancillary": "Auto Ancillary",
    "Service": "Service Providers",
    "Govt": "Govt. Initiatives/Regulations",
    "Global": "Global Updates"
  };

  const formattedDateRange = dateRange || "May 29, 2026";

  // Build list of categories that contain articles
  const sortedCategories = categoriesSOP.filter(catCode => 
    compiledItems.some(item => item.category === catCode)
  );

  // Calculate dynamic starting pages for each news story
  let currentPage = sortedCategories.length > 3 ? 3 : 2; // cover index takes 2 pages if large, else 2
  const itemsWithAssignedPages: (CompiledItem & { assignedPage: number })[] = [];
  const categoryStartPages: Record<string, number> = {};

  sortedCategories.forEach((catCode) => {
    const catItems = compiledItems.filter(item => item.category === catCode);
    if (catItems.length > 0) {
      categoryStartPages[catCode] = currentPage;
      
      catItems.forEach((item) => {
        itemsWithAssignedPages.push({
          ...item,
          assignedPage: currentPage
        });
        
        // Estimate running pages occupied by this story
        const estPages = estimateArticlePageCount(item);
        currentPage += estPages;
      });
    }
  });

  // 1. Build the Table of Contents Index (Grouped strictly by Category)
  let indexHtml = "";
  sortedCategories.forEach((catCode) => {
    const catName = CATEGORY_MAPPINGS[catCode] || catCode;
    const startPage = categoryStartPages[catCode] || 3;
    const catItems = itemsWithAssignedPages.filter(item => item.category === catCode);
    
    // Category Section Header Table with dynamic dots to right margin
    indexHtml += `
      <div style="margin-top: 14pt; margin-bottom: 4pt; clear: both;">
        <table cellpadding="0" cellspacing="0" style="width: 100%; border: none; font-family: 'Calibri', sans-serif;">
          <tr>
            <td style="font-size: 13pt; font-weight: bold; color: #104E5B; text-align: left; vertical-align: bottom; white-space: nowrap; padding-right: 4pt;">
              ${catName}
            </td>
            <td style="border-bottom: 1.5pt dotted #104E5B; font-family: 'Calibri', sans-serif; vertical-align: bottom;">&nbsp;</td>
            <td style="white-space: nowrap; font-size: 11.5pt; font-weight: bold; color: #104E5B; padding-left: 5pt; text-align: right; vertical-align: bottom; width: 30pt;">
              ${startPage}
            </td>
          </tr>
        </table>
      </div>
    `;

    // Category Bullet Articles rows
    catItems.forEach((item) => {
      const cleanedHeadline = cleanContentText(item.news);
      indexHtml += `
        <div style="margin-bottom: 2pt; margin-left: 18pt;">
          <table cellpadding="0" cellspacing="0" style="width: 100%; border: none; font-family: 'Calibri', sans-serif;">
            <tr>
              <td style="font-size: 10.5pt; color: #2D3748; text-align: left; vertical-align: bottom; padding-right: 4pt; line-height: 1.25; width: 85%;">
                &bull;&nbsp;&nbsp;${cleanedHeadline}
              </td>
              <td style="border-bottom: 1pt dotted #94A3B8; font-family: 'Calibri', sans-serif; vertical-align: bottom;">&nbsp;</td>
              <td style="white-space: nowrap; font-size: 10.5pt; color: #4A5568; padding-left: 5pt; text-align: right; vertical-align: bottom; width: 30pt;">
                ${item.assignedPage}
              </td>
            </tr>
          </table>
        </div>
      `;
    });
  });

  // 2. Build the Core News Articles content (Grouped strictly by Category)
  let contentHtml = "";
  sortedCategories.forEach((catCode) => {
    const catName = CATEGORY_MAPPINGS[catCode] || catCode;
    const catItems = itemsWithAssignedPages.filter(item => item.category === catCode);

    if (catItems.length > 0) {
      // Loop through each news item in the category
      catItems.forEach((item, index) => {
        const cleanedHeadline = cleanContentText(item.news);
        const sourceName = getSourceName(item.sourceLink);
        const artDate = formatToDDMMMYYYY(item.date); // Pass actual article date

        contentHtml += `
          <!-- Page Break before every news article to keep pages clean -->
          <br style="page-break-before: always; clear: both;" />
          
          <div style="margin-bottom: 24pt;">
        `;

        if (index === 0) {
          // Category Heading - Calibri, Size 16 (using p tag instead of h1 to avoid Word collapsible heading triangle)
          contentHtml += `
            <p style="font-family: 'Calibri', sans-serif; font-size: 16pt; font-weight: bold; color: #000000; margin-top: 14pt; margin-bottom: 8pt; text-align: left;">
              ${catName}
            </p>
          `;
        }

        contentHtml += `
            <!-- Sub heading - Calibri, Size 13, plain p tag (no h2/heading style or hyperlink) -->
            <p style="font-family: 'Calibri', sans-serif; font-size: 13pt; font-weight: bold; color: #000000; margin-top: 8pt; margin-bottom: 4pt; line-height: 1.2; text-align: left;">
              ${cleanedHeadline}
            </p>
            
            <p style="font-family: 'Calibri', sans-serif; font-size: 10.5pt; font-style: italic; color: #000000; margin-top: 0in; margin-bottom: 2pt; line-height: 1.15;">
              Source Credit: ${sourceName}
            </p>
            <p style="font-family: 'Calibri', sans-serif; font-size: 10.5pt; font-style: italic; color: #000000; margin-top: 0in; margin-bottom: 8pt; line-height: 1.15;">
              Date: ${artDate}
            </p>
            
            <!-- Justified text body paragraphs -->
            <div style="margin-top: 4pt; margin-bottom: 6pt;">
              ${renderArticleParagraphs(item.fullText)}
            </div>
        `;

        if (item.sourceLink) {
          contentHtml += `
            <p style="margin-top: 2pt; margin-bottom: 12pt; text-align: left;">
              <a href="${item.sourceLink}" class="source-link" style="font-family: 'Calibri', sans-serif; font-size: 10pt; color: #2563EB; text-decoration: underline;">
                ${item.sourceLink}
              </a>
            </p>
          `;
        }

        contentHtml += `
          </div>
        `;
      });
    }
  });

  // 3. Wrap everything together inside Microsoft Word compatible HTML body
  const fileContent = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' 
      xmlns:w='urn:schemas-microsoft-com:office:word' 
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <title>India Automotive Weekly News - ${formattedDateRange}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page Section1 {
      size: 8.5in 11.0in;
      margin: 1.0in 1.0in 1.0in 1.0in;
    }
    div.Section1 {
      page: Section1;
    }
    body {
      font-family: 'Calibri', sans-serif;
      font-size: 11pt;
      line-height: 1.15;
      color: #000000;
    }
  </style>
</head>
<body lang="EN-US">
  <div class="Section1">

    <!-- Page 1 BCG Vantage Corporate Header Banner Table -->
    <table cellpadding="0" cellspacing="0" style="width: 100%; background-color: #000000; border-collapse: collapse; margin-bottom: 18pt; border: none; mso-border-alt: none;">
      <tr>
        <!-- Left Banner Detail -->
        <td style="width: 65%; padding: 18pt 18pt 20pt 18pt; vertical-align: top; text-align: left; background-color: #000000;">
          <div style="font-family: 'Calibri', sans-serif; font-size: 32pt; font-weight: bold; color: #FFFFFF; line-height: 1.0; margin: 0; padding: 0;">
            BCG
          </div>
          <div style="font-family: 'Calibri', sans-serif; font-size: 12.5pt; color: #FFFFFF; font-style: italic; margin-top: 4pt; margin-bottom: 16pt; font-weight: normal;">
            India Auto Vantage
          </div>
          
          <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: none;">
            <tr>
              <td style="background-color: #00BFA5; color: #FFFFFF; font-family: 'Calibri', sans-serif; font-size: 14pt; font-weight: bold; padding: 5pt 16pt; vertical-align: middle; white-space: nowrap;">
                India Auto: Weekly Newsletter
              </td>
            </tr>
          </table>
        </td>
        <!-- Right Headlight Decorative Block -->
        <td style="width: 35%; background-color: #000000; vertical-align: middle; text-align: right; padding-right: 18pt;">
          <div style="display: inline-block; width: 140pt; height: 75pt; border-radius: 90pt 10pt 60pt 10pt; border-left: 4.5pt solid #FFFFFF; border-top: 1.5pt solid #CBD5E1; background-color: #0F172A; text-align: center; vertical-align: middle;">
            <table cellpadding="0" cellspacing="0" style="width: 100%; height: 100%;">
              <tr>
                <td style="text-align: center; vertical-align: middle;">
                  <span style="font-family: 'Calibri', sans-serif; font-size: 9pt; color: #64748B; font-weight: bold; letter-spacing: 2px;">VANTAGE</span>
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>
    </table>

    <!-- Heading - Calibri, Size 16 (p tag) -->
    <p id="toc-header" style="font-family: 'Calibri', sans-serif; font-size: 16pt; font-weight: bold; color: #000000; margin-top: 14pt; margin-bottom: 12pt; border: none; padding: 0;">
      Contents
    </p>

    <!-- Completed Table of Contents with dynamic dotted grid align leaders -->
    ${indexHtml}

    <!-- Dynamic news stories content section -->
    ${contentHtml}

  </div>
</body>
</html>
`;

  // Construct binary file buffer and execute dynamic download as Word document
  const blob = new Blob([fileContent], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Newsletter_Word_Compiled_${formattedDateRange.replace(/\s+/g, '_')}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateAndDownloadSummaryWordDoc(
  articles: Array<{
    headline: string;
    sourceLink: string;
    summary: string;
    category?: string;
    publishDate?: string;
    sourceName?: string;
  }>,
  title: string = "Summarized_News_Report"
) {
  // Group articles by category preserving top-to-bottom appearance sequence
  const categoryOrder: string[] = [];
  const groups: Record<string, typeof articles> = {};
  articles.forEach((art) => {
    const cat = art.category?.trim() || "General News";
    if (!groups[cat]) {
      groups[cat] = [];
      categoryOrder.push(cat);
    }
    groups[cat].push(art);
  });

  let contentHtml = "";

  categoryOrder.forEach((categoryName) => {
    const groupArticles = groups[categoryName];
    const cleanCategory = applyStrictSOPCleaning(categoryName);
    // Category Heading - Calibri, styled inside a teal table cell block to match the image
    contentHtml += `
      <table border="0" cellspacing="0" cellpadding="0" style="width: 100%; background: #3aa68c; margin-top: 18pt; margin-bottom: 8pt;">
        <tr>
          <td style="padding: 6pt 12pt;">
            <p style="font-family: 'Calibri', sans-serif; font-size: 13.5pt; font-weight: bold; color: #ffffff; margin: 0; text-align: left;">
              ${cleanCategory}
            </p>
          </td>
        </tr>
      </table>
    `;

    groupArticles.forEach((art, idx) => {
      const headlineText = art.headline || `News Article ${idx + 1}`;
      const cleanHeadline = applyStrictSOPCleaning(headlineText);
      const cleanSummary = applyStrictSOPCleaning(art.summary);

      // Determine if it's an EV news story
      const combinedText = `${headlineText} ${art.summary} ${categoryName}`.toLowerCase();
      const isEV = combinedText.includes("electric") || 
                   combinedText.includes("ev ") || 
                   combinedText.includes(" evs") || 
                   combinedText.includes("/ev") || 
                   combinedText.includes("electrif") || 
                   combinedText.includes("battery") || 
                   combinedText.includes("charger") || 
                   combinedText.includes("charging") || 
                   categoryName.toLowerCase().includes("electrification");

      contentHtml += `
        <div style="margin-bottom: 14pt; margin-left: 0pt;">
          <!-- Sub heading - Calibri, Size 11.5pt, bold teal/blue text, with optional Electric Vehicle red tag -->
          <p style="font-family: 'Calibri', sans-serif; font-size: 11.5pt; font-weight: bold; margin-top: 8pt; margin-bottom: 4pt; line-height: 1.2; text-align: left;">
            <a href="${art.sourceLink || '#'}" style="color: #1f6d78; text-decoration: none;">
              ${cleanHeadline}
            </a>
            ${isEV ? ` <span style="color: #ff0000; font-weight: bold; font-size: 9pt; margin-left: 6pt;">Electric Vehicle</span>` : ''}
          </p>
          
          <!-- Justified text body paragraphs preserving original paragraph breaks -->
          <div style="margin-top: 4pt; margin-bottom: 6pt;">
            ${renderArticleParagraphs(art.summary)}
          </div>
      `;

      if (art.publishDate || art.sourceName || art.sourceLink) {
        const formattedDate = formatToDDMMMYYYY_Spaced(art.publishDate);
        const resolvedSource = formatSourceName(art.sourceName || (art.sourceLink ? getSourceName(art.sourceLink) : "ET Auto"));
        contentHtml += `
          <p style="font-family: 'Calibri', sans-serif; font-size: 9.5pt; color: #1f6d78; font-weight: bold; margin-top: 2pt; margin-bottom: 12pt; text-align: left;">
            (${formattedDate}, Source: ${resolvedSource})
          </p>
        `;
      }


      contentHtml += `
        </div>
      `;
    });
  });

  const fileContent = `
<html xmlns:o='urn:schemas-microsoft-com:office:office' 
      xmlns:w='urn:schemas-microsoft-com:office:word' 
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <title>Automated Summaries Report</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page Section1 {
      size: 8.5in 11.0in;
      margin: 1.0in 1.0in 1.0in 1.0in;
    }
    div.Section1 {
      page: Section1;
    }
    body {
      font-family: 'Calibri', sans-serif;
      font-size: 11pt;
      line-height: 1.25;
      color: #000000;
    }
  </style>
</head>
<body lang="EN-US">
  <div class="Section1">
    <!-- Title - Calibri, Size 16 (plain p tag) -->
    <p style="font-family: 'Calibri', sans-serif; font-size: 16pt; font-weight: bold; color: #000000; margin-top: 0in; margin-bottom: 16pt; border-bottom: 1pt solid #CBD5E1; padding-bottom: 6pt;">
      Automated News Summaries
    </p>
    ${contentHtml}
  </div>
</body>
</html>
  `;

  const blob = new Blob([fileContent], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeTitle = title.replace(/[^a-zA-Z0-9_]/g, '_');
  a.download = `Summarized_News_${safeTitle}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


