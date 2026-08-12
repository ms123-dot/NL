# Project Instructions & Conventions

## Word File Drafting Rules
- **Verbatim Extraction Mandate**: Whenever shortlisted headlines are provided, extract the **complete, exact, and verbatim content** that appears **directly below each shortlisted headline**. Do **not** summarize, paraphrase, rewrite, shorten, or omit any part of the article text. Preserve the original wording, paragraph structure, punctuation, numbers, hyperlinks, quotations, bullet points, and formatting exactly as they appear in the source.
- **Ensured Accuracy Checklist**:
  - Every shortlisted headline must be matched with its corresponding full article content.
  - No text from another headline or article is mixed into the output.
  - No content is skipped, truncated, or hallucinated.
  - If the content spans multiple paragraphs, extract **all** of them until the next headline or article begins.
  - If any content is missing or inaccessible, explicitly state **"Content not available"** instead of guessing.
- **Paragraph Formatting**: Always preserve the exact paragraph/line break structure from the raw uploaded news files. Do not merge lines or automatically reconstruct paragraphs into larger blocks. The text or body of the news stories must remain in the original small paragraph format as given in the raw uploaded documents.
- **Stick To Headline & Extract Full Content**: For each curated news headline, locate its exact position in the raw source text and extract the complete, full text that is written directly below that headline up until its source URL link. Do not shorten, truncate, paraphrase, summarize, or discard any paragraphs. Do not pull content from anywhere else. Ensure that the entire verbatim content of each shortlisted news item is pasted properly in the Word file.
- **Strict Matching Rules (Zero Mismatches/Cross-Article Bleed)**: 
  - Never extract content from the Table of Contents (TOC) at the beginning of the raw files (which typically contain dots like `...` and page numbers).
  - Use exact or highly specific keyword/substring matching to find the true full story body further down in the file.
  - Set strict boundaries to stop copying as soon as another curated headline or a file delimiter is encountered, ensuring that one story's content never bleeds into another, nor steals another story's source URL.

## Excluded Components
- **Manual Findings Assistant**: This component has been completely removed from the application as the automated "Scan & Ingest" capability is sufficient. Do not re-add any manual headline recommendation banners or quick-inject modules unless explicitly requested.

## News Shortlisting Rules
- **Look for Both Left & Right Columns**: When shortlisting and curating news from uploaded files or spreadsheets, always look for both the Left side and the Right side of the table of news. Both columns (Left and Right columns) of the tables contain distinct, high-value news stories that must be processed and captured fully. Do not ignore the right column.
- **At Least 10-15 News Items Per Day**: Thoroughly check each daily uploaded document/file and shortlist at least 10-15 news items per day file without exception. Do not under-shortlist news under any circumstances.
- **News for Each Category From Each Day File**: Actively analyze each single uploaded day file to find and extract news matching each of the 7 SOP categories (Corporate, Electrification, New Product, Auto Ancillary, Service, Govt, Global). Ensure that you strive to populate all 7 categories from that single day's file, paying close attention to sub-agreements, state-level initiatives, supplier deals, or international OEM/ancillary updates so that no category is left empty if suitable updates exist.

