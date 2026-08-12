
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Initialize PDF.js worker using Vite asset URL or jsdelivr CDN fallback (.mjs)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker || `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export async function parseFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'pdf':
      return parsePDF(file);
    case 'docx':
      return parseDocx(file);
    case 'xlsx':
    case 'xls':
      return parseExcel(file);
    case 'txt':
    case 'html':
      return file.text();
    default:
      return file.text();
  }
}

async function parsePDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return htmlToTextWithLinks(result.value);
}

function htmlToTextWithLinks(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Replace every link with "visible text URL" so the URL stays in the plain text
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href && !href.startsWith('#')) {
      const textNode = doc.createTextNode(`${a.textContent} ${href}`);
      a.replaceWith(textNode);
    }
  });

  // Preserve paragraph/line breaks
  doc.querySelectorAll('p, br, li, tr, h1, h2, h3, h4, h5, h6').forEach(el => {
    el.insertAdjacentText('afterend', '\n');
  });

  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}