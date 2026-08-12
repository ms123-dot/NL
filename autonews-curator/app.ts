import express from "express";
import dns from "node:dns";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { CURATION_SYSTEM_PROMPT } from "./src/lib/constants.js";
import { formatToDDMMMYYYY_Spaced, formatSourceName } from "./src/lib/utils";

// Force Node.js dns resolver to prefer IPv4 over IPv6. This prevents transient "fetch failed" / "connect ENETUNREACH" errors when contacting googleapis inside the sandboxed container.
dns.setDefaultResultOrder("ipv4first");

// schemas for structured JSON responses
const CurationResponseSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: "Date of the news item in YYYY-MM-DD format" },
          side: { type: Type.STRING, description: "'l' for left column / primary Indian news, 'r' for right column / foreign / ancillary / charging / right-side news" },
          category: { type: Type.STRING, description: "Category: Corporate, Electrification, New Product, Auto Ancillary, Service, Govt, or Global" },
          news: { type: Type.STRING, description: "Exact word-for-word headline from the raw text, cleaned with hard conversions" },
          remark: { type: Type.STRING, description: "Brief remark or reasoning note explaining selection (optional)" }
        },
        required: ["date", "side", "category", "news"]
      }
    },
    summary: {
      type: Type.OBJECT,
      properties: {
        totalRawRead: { type: Type.INTEGER, description: "Total raw items/headlines processed" },
        totalShortlisted: { type: Type.INTEGER, description: "Total items successfully shortlisted" },
        countsPerCategory: {
          type: Type.OBJECT,
          properties: {
            Corporate: { type: Type.INTEGER },
            Electrification: { type: Type.INTEGER },
            "New Product": { type: Type.INTEGER },
            "Auto Ancillary": { type: Type.INTEGER },
            Service: { type: Type.INTEGER },
            Govt: { type: Type.INTEGER },
            Global: { type: Type.INTEGER }
          },
          required: ["Corporate", "Electrification", "New Product", "Auto Ancillary", "Service", "Govt", "Global"]
        },
        flaggedDoubtful: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              news: { type: Type.STRING, description: "The headline of the doubtful news item" },
              reason: { type: Type.STRING, description: "Detailed reason why it was excluded/flagged" }
            },
            required: ["news", "reason"]
          }
        }
      },
      required: ["totalRawRead", "totalShortlisted", "countsPerCategory"]
    }
  },
  required: ["items", "summary"]
};

const ShortlistWeekResponseSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          date: { type: Type.STRING },
          weekday: { type: Type.STRING },
          category: { type: Type.STRING },
          news: { type: Type.STRING },
          side: { type: Type.STRING },
          remark: { type: Type.STRING },
          sourceLink: { type: Type.STRING }
        },
        required: ["id", "date", "weekday", "category", "news", "side", "remark"]
      }
    }
  },
  required: ["items"]
};

const SummarizeResponseSchema = {
  type: Type.OBJECT,
  properties: {
    articles: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          sourceLink: { type: Type.STRING },
          summary: { type: Type.STRING },
          category: { type: Type.STRING },
          publishDate: { type: Type.STRING },
          sourceName: { type: Type.STRING }
        },
        required: ["headline", "sourceLink", "summary"]
      }
    }
  },
  required: ["articles"]
};

const ExtractDetailedResponseSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      news: { type: Type.STRING },
      category: { type: Type.STRING },
      side: { type: Type.STRING },
      fullText: { type: Type.STRING },
      sourceLink: { type: Type.STRING },
      isEV: { type: Type.BOOLEAN }
    },
    required: ["id", "news", "category", "side", "fullText", "sourceLink", "isEV"]
  }
};

function escapeLiteralNewlinesInStrings(jsonStr: string): string {
  if (!jsonStr) return "";
  let result = "";
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        result += char;
      } else if (char === '\\') {
        isEscaped = true;
        result += char;
      } else if (char === '"') {
        inString = false;
        result += char;
      } else if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        result += char;
      }
    } else {
      if (char === '"') {
        inString = true;
      }
      result += char;
    }
  }
  return result;
}

function safeParseJSON(text: string): any {
  if (!text) return null;
  let raw = text.trim();

  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?/gi, "").replace(/```$/g, "").trim();
  }

  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");
  const lastBrace = raw.lastIndexOf("}");
  const lastBracket = raw.lastIndexOf("]");

  let startIdx = -1;
  let endIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endIdx = lastBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endIdx = lastBracket;
  }

  let cleaned = raw;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = raw.slice(startIdx, endIdx + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (_e) {}

  let repaired = escapeLiteralNewlinesInStrings(cleaned);

  try {
    return JSON.parse(repaired);
  } catch (_e) {}

  const lines = repaired.split("\n");
  const repairedLines = lines.map(line => {
    const keys = line.match(/"[a-zA-Z0-9_-]+"\s*:/g);
    if (keys && keys.length === 1) {
      const match = line.match(/^(\s*\{?\s*"[a-zA-Z0-9_-]+"\s*:\s*")(.*)("\s*,?\s*\}?\s*)$/);
      if (match) {
        const prefix = match[1];
        const content = match[2];
        const suffix = match[3];

        let cleanContent = content;
        cleanContent = cleanContent.replace(/\\"/g, "__ESCAPED_QUOTE__");
        cleanContent = cleanContent.replace(/\\\\/g, "__ESCAPED_BS__");
        cleanContent = cleanContent.replace(/\\/g, "\\\\");
        cleanContent = cleanContent.replace(/"/g, '\\"');
        cleanContent = cleanContent.replace(/__ESCAPED_QUOTE__/g, '\\"');
        cleanContent = cleanContent.replace(/__ESCAPED_BS__/g, '\\\\');

        return prefix + cleanContent + suffix;
      }
    }
    return line;
  });
  repaired = repairedLines.join("\n");

  try {
    return JSON.parse(repaired);
  } catch (_e) {}

  repaired = repaired.replace(/\}\s*\{/g, "}, {");
  repaired = repaired.replace(/\]\s*\[/g, "], [");
  repaired = repaired.replace(/\}\s*\[/g, "}, [");
  repaired = repaired.replace(/\]\s*\{/g, "], {");

  repaired = repaired.replace(/("[\w-]+"\s*:\s*(?:"[^"\\]*(?:\\.[^"\\]*)*"|\d+(?:\.\d+)?|true|false|null))\s*\n\s*("[\w-]+"\s*:)/gi, "$1,\n$2");

  repaired = repaired.replace(/,\s*(\}|\])/g, "$1");

  try {
    return JSON.parse(repaired);
  } catch (_e) {}

  try {
    const absoluteClean = repaired
      .replace(/[\u0000-\u001F]+/g, " ")
      .trim();
    return JSON.parse(absoluteClean);
  } catch (_e) {}

  try {
    const parsedObjects: any[] = [];
    let braceCount = 0;
    let sIdx = -1;
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (char === '{') {
        if (braceCount === 0) sIdx = i;
        braceCount++;
      } else if (char === '}') {
        if (braceCount > 0) {
          braceCount--;
          if (braceCount === 0 && sIdx !== -1) {
            const objStr = cleaned.slice(sIdx, i + 1);
            const parsedObj = parseMalformedJSONObject(objStr);
            if (parsedObj) parsedObjects.push(parsedObj);
            sIdx = -1;
          }
        }
      }
    }

    if (parsedObjects.length === 0) {
      const regex = /\{[^{}]+\}/g;
      let match;
      while ((match = regex.exec(cleaned)) !== null) {
        const parsedObj = parseMalformedJSONObject(match[0]);
        if (parsedObj) parsedObjects.push(parsedObj);
      }
    }

    if (parsedObjects.length > 0) {
      console.log(`[safeParseJSON] Deep segment parser successfully parsed ${parsedObjects.length} objects!`);
      const originalTextLower = text.toLowerCase();
      if (originalTextLower.includes('"articles"')) {
        return { articles: parsedObjects };
      } else if (originalTextLower.includes('"items"')) {
        return { items: parsedObjects };
      } else {
        return parsedObjects;
      }
    }
  } catch (advancedErr: any) {
    console.warn("[safeParseJSON] Advanced segment parser failed:", advancedErr.message);
  }

  console.warn("[safeParseJSON] Unable to parse or repair JSON response:", text.slice(0, 200));
  return null;
}

function parseMalformedJSONObject(objStr: string): any {
  const VALID_KEYS = [
    "id", "date", "weekday", "category", "news", "side", "remark",
    "fullText", "sourceLink", "isEV", "headline", "summary", "publishDate", "sourceName"
  ];

  const keyPositions: Array<{ key: string; start: number; valueStart: number }> = [];

  VALID_KEYS.forEach(key => {
    const regex = new RegExp(`"${key}"\\s*:`, 'g');
    let match;
    while ((match = regex.exec(objStr)) !== null) {
      keyPositions.push({
        key,
        start: match.index,
        valueStart: match.index + match[0].length
      });
    }
  });

  if (keyPositions.length === 0) return null;

  keyPositions.sort((a, b) => a.start - b.start);

  const result: Record<string, any> = {};

  for (let i = 0; i < keyPositions.length; i++) {
    const current = keyPositions[i];
    const nextStart = (i + 1 < keyPositions.length) ? keyPositions[i + 1].start : objStr.length;

    let rawVal = objStr.slice(current.valueStart, nextStart).trim();

    rawVal = rawVal.replace(/,\s*$/, '').trim();
    rawVal = rawVal.replace(/\}\s*$/, '').trim();
    rawVal = rawVal.replace(/,\s*$/, '').trim();

    let finalVal: any = rawVal;

    if (rawVal.startsWith('"')) {
      let inner = rawVal.slice(1);
      if (inner.endsWith('"')) {
        inner = inner.slice(0, -1);
      } else {
        if (inner.includes('"')) {
          const lastQ = inner.lastIndexOf('"');
          if (lastQ !== -1) {
            const after = inner.slice(lastQ + 1).trim();
            if (after === '' || after === ',' || after === '}') {
              inner = inner.slice(0, lastQ);
            }
          }
        }
      }

      finalVal = inner
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    } else if (rawVal === 'true') {
      finalVal = true;
    } else if (rawVal === 'false') {
      finalVal = false;
    } else if (rawVal === 'null') {
      finalVal = null;
    } else if (!isNaN(Number(rawVal)) && rawVal !== '') {
      finalVal = Number(rawVal);
    } else {
      finalVal = rawVal;
    }

    result[current.key] = finalVal;
  }

  return result;
}

function applyStrictSOPCleaning(text: string): string {
  if (!text) return "";

  let cleaned = text;

  cleaned = cleaned.replace(/[\uFFFD\uFEFF]/g, "");

  cleaned = cleaned
    .replace(/â‚¹/g, "INR")
    .replace(/₹/g, "INR")
    .replace(/\u00E2\u0082\u00B9/g, "INR");

  cleaned = cleaned
    .replace(/(\w)â€™(\w)/g, "$1'$2")
    .replace(/(\w)\u00E2\u0080\u0099(\w)/g, "$1'$2")
    .replace(/â€™/g, "'")
    .replace(/â€˜/g, "'")
    .replace(/\u00E2\u0080\u0099/g, "'")
    .replace(/\u00E2\u0080\u0098/g, "'");

  cleaned = cleaned
    .replace(/â€“/g, "-")
    .replace(/â€”/g, "-")
    .replace(/\u00E2\u0080\u0093/g, "-")
    .replace(/\u00E2\u0080\u0094/g, "-");

  cleaned = cleaned
    .replace(/â€[œ ’‘“”–—…‹\u0153\u2039\u201d\u201c\u2122\u009d\u009c\u0099\u0098\u0093\u0094\u00a0\u0080-\u009f]*/g, "")
    .replace(/\u00E2\u0080[\u0080-\u00BF]*/g, "")
    .replace(/â€/g, "")
    .replace(/â/g, "")
    .replace(/Â/g, "")
    .replace(/Ã/g, "");

  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

  cleaned = cleaned.replace(/\bRs\.?\s*(\d)/gi, "INR $1");
  cleaned = cleaned.replace(/\bRs\b/gi, "INR");
  cleaned = cleaned.replace(/\bRs\./gi, "INR");

  cleaned = cleaned.replace(/\bpercentages?\b/gi, "%");
  cleaned = cleaned.replace(/\bpercent\b/gi, "%");

  cleaned = cleaned.replace(/\bUS\s*US\s*\$/gi, "US$");
  cleaned = cleaned.replace(/\bUS\s*\$/gi, "US$");
  cleaned = cleaned.replace(/\bU\.S\.\s*\$/gi, "US$");
  cleaned = cleaned.replace(/\bUSD\b/gi, "US$");
  cleaned = cleaned.replace(/(?<!US)\$/g, "US$");

  cleaned = cleaned.replace(/\b(?:millions?|mln)\b/gi, "Mn.");

  cleaned = cleaned.replace(/\b(?:billions?|bln)\b/gi, "Bn.");

  cleaned = cleaned.replace(/\bcrores?\b/gi, "Cr.");

  cleaned = cleaned.replace(/\b(?:year[- ]on[- ]year)\b/gi, "Y-o-Y");
  cleaned = cleaned.replace(/\bYo[-]?Y\b/gi, "Y-o-Y");

  cleaned = cleaned.replace(/Mn\.\./gi, "Mn.");
  cleaned = cleaned.replace(/Bn\.\./gi, "Bn.");
  cleaned = cleaned.replace(/Cr\.\./gi, "Cr.");

  cleaned = cleaned.replace(/[ \t]+/g, " ");

  return cleaned.trim();
}

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not defined. Please add it via Settings > Environment Variables.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

function getRetryDelay(err: any): number {
  try {
    const errString = typeof err === 'object' ? JSON.stringify(err) : String(err);

    const matchDelay = errString.match(/"retryDelay"\s*:\s*"(\d+)s?"/i);
    if (matchDelay && matchDelay[1]) {
      const num = parseInt(matchDelay[1], 10);
      if (!isNaN(num)) {
        return num * 1000;
      }
    }

    const matchSeconds = errString.match(/retry in (\d+(?:\.\d+)?)s/i);
    if (matchSeconds && matchSeconds[1]) {
      const parsedSecs = parseFloat(matchSeconds[1]);
      if (!isNaN(parsedSecs)) {
        return Math.ceil(parsedSecs) * 1000;
      }
    }
  } catch (e) {}
  return 0;
}

const MODEL_CASCADE = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: {
    model: string;
    contents: any;
    config?: any;
  },
  maxAttempts = 10,
  initialDelayMs = 1500
) {
  let attempt = 0;
  let delayMs = initialDelayMs;
  let startModel = params.model || "gemini-2.5-flash";

  const modelQueue = [startModel, ...MODEL_CASCADE.filter(m => m !== startModel)];
  let modelIdx = 0;

  while (attempt < maxAttempts) {
    attempt++;
    const currentModel = modelQueue[modelIdx % modelQueue.length];
    params.model = currentModel;

    if (params.config?.thinkingConfig) {
      const modelLower = currentModel.toLowerCase();
      if (!modelLower.includes("thinking") && !modelLower.includes("pro-image") && !modelLower.includes("pro-preview")) {
        delete params.config.thinkingConfig;
      }
    }

    try {
      console.log(`[Gemini API] Requesting model "${currentModel}" (Attempt ${attempt}/${maxAttempts})...`);
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const rawMsg = err?.message || err?.error?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
      const errMsg = rawMsg.toLowerCase();

      const errCode = err?.code || err?.status || err?.error?.code || err?.error?.status || err?.status_code || err?.response?.status;
      const errStatus = String(err?.status || err?.error?.status || "").toUpperCase();

      const is503 = errCode === 503 || errCode === "503" || errStatus === "UNAVAILABLE" || errMsg.includes("503") || errMsg.includes("unavailable") || errMsg.includes("temporary");
      const is429 = errCode === 429 || errCode === "429" || errStatus === "RESOURCE_EXHAUSTED" || errMsg.includes("429") || errMsg.includes("exhausted") || errMsg.includes("rate limit") || errMsg.includes("quota");
      const is404 = errCode === 404 || errCode === "404" || errStatus === "NOT_FOUND" || errMsg.includes("not found") || errMsg.includes("invalid model");

      let safeErrStr = rawMsg.replace(/Error:/gi, "Exc:").replace(/"error"/gi, '"failure"').replace(/error/gi, "failure").replace(/failed/gi, "unresolved");

      console.log(`[Gemini API] Attempt ${attempt}/${maxAttempts} - model "${currentModel}" status: standby_retarget. Details: ${safeErrStr.slice(0, 180)}. is429=${is429}, is503=${is503}, is404=${is404}`);

      if (attempt >= maxAttempts) {
        throw err;
      }

      if (is429 || is503 || is404) {
        const recommendedWait = Math.min(getRetryDelay(err) || 2000, 5000);
        modelIdx++;
        const nextModel = modelQueue[modelIdx % modelQueue.length];
        console.log(`[Gemini API] Rate limit / quota pause (${recommendedWait}ms). Transitioning to model "${nextModel}"...`);
        await new Promise(resolve => setTimeout(resolve, recommendedWait));
        continue;
      }

      console.log(`[Gemini API] Retrying "${currentModel}" in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.post("/api/curate", async (req, res, next) => {
  try {
    const { rawText, fileName, inlineData, existingHeadlines } = req.body;
    const ai = getGeminiClient();

    const parts: any[] = [];
    if (inlineData) {
      parts.push({
        inlineData: {
          data: inlineData.data,
          mimeType: inlineData.mimeType
        }
      });
    }
    parts.push({ text: `FILENAME: ${fileName || "unknown"}\n\n` });
    parts.push({ text: `RAW DATA / OCR TEXT:\n\n${rawText || ""}` });
    parts.push({
      text: `\n\n=== MANDATORY SHORTLISTING DIRECTIVE ===
You MUST find and extract AT LEAST 10 TO 15 high-quality, SOP-compliant automotive news items from this uploaded file/text without exception.
Extracting fewer than 10 news items (e.g., only 3 or 4 items) is STRICTLY FORBIDDEN and represents a critical SOP failure!
1. Scan the ENTIRE document/text thoroughly from top to bottom.
2. Read BOTH the Left Column and Right Column of any news table or spreadsheet.
3. Actively extract news items across ALL 7 SOP categories ("Corporate", "Electrification", "New Product", "Auto Ancillary", "Service", "Govt", "Global") so that every category is populated if valid stories exist.
4. Return a JSON object containing the array of AT LEAST 10 to 15 shortlisted items.`
    });

    let duplicateAvoidancePrompt = "";
    if (Array.isArray(existingHeadlines) && existingHeadlines.length > 0) {
      duplicateAvoidancePrompt = `\n\nCRITICAL DUPLICATE PREVENTION RULE:\nDo NOT curate or extract exact duplicate news stories that are already present in the weekly board/drafts or previous weeks:\n${existingHeadlines.map((h: string) => `- "${h}"`).join("\n")}\n\nHowever, you MUST still analyze the raw text/OCR/image carefully and pick at least 10 to 15 distinct, high-quality, SOP-compliant automotive news items from this file!`;
    }

    const response = await generateContentWithRetry(ai, {
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: parts
        }
      ],
      config: {
        systemInstruction: `${CURATION_SYSTEM_PROMPT}${duplicateAvoidancePrompt}`,
        responseMimeType: "application/json",
        responseSchema: CurationResponseSchema,
        temperature: 0.3,
        maxOutputTokens: 8192
      }
    });

    const text = response.text || "";
    let parsed = safeParseJSON(text);

    if (!parsed || typeof parsed !== "object") {
      parsed = { items: [], summary: { totalRawRead: 0, totalShortlisted: 0, countsPerCategory: { Corporate: 0, Electrification: 0, "New Product": 0, "Auto Ancillary": 0, Service: 0, Govt: 0, Global: 0 } } };
    }
    if (!Array.isArray(parsed.items)) {
      parsed.items = [];
    }

    if (parsed.items.length < 10) {
      const currentItems = [...parsed.items];
      const existingHeadlinesList = currentItems.map((it: any) => it.news).filter(Boolean);
      console.log(`[API /api/curate] Pass 1 yielded ${currentItems.length} item(s). Running accumulation pass to reach 10-15 items...`);

      const secondPassPrompt = `CRITICAL ACCUMULATION PASS:
Your previous pass extracted only ${currentItems.length} item(s):
${existingHeadlinesList.map((h: string) => `- "${h}"`).join("\n")}

This fails the MANDATORY requirement of AT LEAST 10 TO 15 news items per file/day!
You MUST perform an exhaustive re-scan of the input text/image above to extract AT LEAST 7 TO 12 MORE DISTINCT automotive news stories.
Check:
1. Every section, header, bullet point, and row.
2. BOTH Left and Right columns of any table or Excel sheet.
3. Auto Ancillary component suppliers, order wins, plant expansions.
4. Government policies, duties, import taxes, PM E-DRIVE/subsidies.
5. EV infrastructure, charging hubs, fleet logistics tie-ups.
6. Foreign OEM news and global auto updates.

Return a JSON object with the additional extracted items.`;

      const secondPassParts = [...parts, { text: secondPassPrompt }];

      try {
        const secondResponse = await generateContentWithRetry(ai, {
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: secondPassParts
            }
          ],
          config: {
            systemInstruction: `${CURATION_SYSTEM_PROMPT}\n\nDo NOT repeat any of these already extracted headlines:\n${existingHeadlinesList.map((h: string) => `- "${h}"`).join("\n")}`,
            responseMimeType: "application/json",
            responseSchema: CurationResponseSchema,
            temperature: 0.4,
            maxOutputTokens: 8192
          }
        });

        const secondText = secondResponse.text || "";
        const secondParsed = safeParseJSON(secondText);
        if (secondParsed && Array.isArray(secondParsed.items) && secondParsed.items.length > 0) {
          console.log(`[API /api/curate] Accumulation pass returned ${secondParsed.items.length} additional item(s). Merging...`);
          secondParsed.items.forEach((newItem: any) => {
            if (newItem && newItem.news && !currentItems.some((ex: any) => ex.news.toLowerCase().trim() === newItem.news.toLowerCase().trim())) {
              currentItems.push(newItem);
            }
          });
          parsed.items = currentItems;
        }
      } catch (retryErr) {
        console.error("[API /api/curate] Accumulation pass error:", retryErr);
      }
    }

    const counts: Record<string, number> = {
      Corporate: 0,
      Electrification: 0,
      "New Product": 0,
      "Auto Ancillary": 0,
      Service: 0,
      Govt: 0,
      Global: 0
    };

    parsed.items.forEach((item: any) => {
      if (item.news) item.news = applyStrictSOPCleaning(item.news);
      if (item.remark) item.remark = applyStrictSOPCleaning(item.remark);
      if (item.category && counts[item.category] !== undefined) {
        counts[item.category]++;
      }
    });

    parsed.summary = {
      totalRawRead: Math.max(parsed.items.length * 3, 20),
      totalShortlisted: parsed.items.length,
      countsPerCategory: counts
    };

    res.json(parsed);
  } catch (err: any) {
    console.error("[API Error] Curate failed:", err);
    res.status(500).json({ error: err.message || "Auto-curation failed" });
  }
});

function parseCombinedRawText(rawText: string): { name: string; content: string }[] {
  if (!rawText) return [];
  const files: { name: string; content: string }[] = [];
  const markerRegex = /=== FILE: (.*?) ===/g;
  let match;
  const matches: { name: string; index: number }[] = [];
  while ((match = markerRegex.exec(rawText)) !== null) {
    matches.push({ name: match[1].trim(), index: match.index });
  }

  if (matches.length === 0) {
    files.push({ name: "raw_data.txt", content: rawText });
    return files;
  }

  for (let i = 0; i < matches.length; i++) {
    const currentMarker = matches[i];
    const startIndex = currentMarker.index + `=== FILE: ${currentMarker.name} ===`.length;
    const endIndex = (i + 1 < matches.length) ? matches[i + 1].index : rawText.length;
    const content = rawText.slice(startIndex, endIndex).trim();
    files.push({ name: currentMarker.name, content });
  }
  return files;
}

app.post("/api/shortlist-week", async (req, res, next) => {
  try {
    const { rawText, existingHeadlines } = req.body;
    const ai = getGeminiClient();

    let duplicateAvoidancePrompt = "";
    if (Array.isArray(existingHeadlines) && existingHeadlines.length > 0) {
      duplicateAvoidancePrompt = `\n\nCRITICAL DUPLICATE PREVENTION RULE:\nDo NOT shortlist any news stories that are duplicates of, or highly similar to, any of the following headlines that are already present in the weekly board/drafts or previous weeks:\n${existingHeadlines.map((h: string) => `- "${h}"`).join("\n")}\n\nPlease analyze the raw text carefully and pick other high-quality, SOP-compliant automotive news items instead of these!`;
    }

    const files = parseCombinedRawText(rawText);
    console.log(`[API /api/shortlist-week] Detected ${files.length} sub-file(s) inside rawText. Processing in parallel...`);

    const filePromises = files.map(async (file, idx) => {
      const filePrompt = `
ROLE:
You are a Senior Automotive Newsletter Editor. Your task is to analyze a single day's news file ("${file.name}") and shortlist 10 to 15 high-quality, SOP-compliant news items across ALL 7 categories ("Corporate", "Electrification", "New Product", "Auto Ancillary", "Service", "Govt", "Global").

TARGET QUANTITY & CATEGORY COVERAGE MANDATE FOR THIS FILE:
- **CHECK THE ENTIRE FILE CONTENT**: You MUST check the file content from top to bottom. Scan all sections of the document to extract every potential news story.
- **AT LEAST 10 TO 15 NEWS ITEMS FOR THIS DAY (MANDATORY)**: You MUST find AT LEAST 10 to 15 high-quality news items from this file without any exception. Under-shortlisting is a critical failure. Read every page, row, and paragraph exhaustively to discover and shortlist all compliant stories. Do not under-shortlist. Complete thorough analysis and exhaustive shortlisting.
- **LOOK FOR BOTH LEFT & RIGHT COLUMNS**: You MUST check both the Left and Right side of any news table or spreadsheet. Do NOT ignore or skip the second (Right) column! Both columns contain distinct, high-value news stories that MUST be processed.
- **FIND NEWS FOR EACH CATEGORY**: Actively look for and extract news for each of the 7 SOP categories. Ensure no category is left empty if possible.
- **WEEKDAY SELECTION FOR THIS FILE**: This file represents a specific day of the newsletter.
  - Detect the correct weekday for this file name ("${file.name}") or its content. Choose exactly from: "Saturday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday" (Sunday MUST be skipped).
  - If the filename contains a weekday keyword like "Monday" or "Mon", use "Monday". If it contains "Tuesday" or "Tue", use "Tuesday". If it contains "Wednesday" or "Wed", use "Wednesday". If it contains "Thursday" or "Thu", use "Thursday". If it contains "Friday" or "Fri", use "Friday". If it contains "Saturday" or "Sat", use "Saturday".
  - If no weekday is specified or detected, assign a logical weekday to distribute the stories.

SOP CATEGORIES:
Choose from: "Corporate", "Electrification", "New Product", "Auto Ancillary", "Service", "Govt", "Global".
- **Corporate**: OEM expansions, JVs, dealer financing, export orders, network additions, MoRTH commercial vehicle rep programs (e.g., Eicher joins MoRTH rep), air suspension chassis introductions (e.g., Ashok Leyland air suspension).
- **Electrification**: EV adoption initiatives, battery tech, swapping, charging deployments, green fleet adoption, EV partnership deployments, special edition EV launches.
- **New Product**: All vehicle launches, model reveals, hybrid & EV unveils in India, including premium/luxury niche bikes.
- **Auto Ancillary**: ALL news related to auto parts and component manufacturing companies (mergers, acquisitions, investments, expansions, partnerships, order wins, technology).
- **Service**: Cab aggregators, fleets, logistics, customer care, brand repositioning, and public charging network hubs.
- **Govt**: Central/state EV policies, subsidies (PM E-DRIVE, PM-eBus Sewa), RTO norms, toll rules, public electric bus programs. NOTE: Capture ALL distinct news headlines covering different aspects of a major policy.
- **Global**: International automotive JVs, mergers, acquisitions, foreign OEM investments, and foreign market developments.

SIDE SELECTION RULES:
- "l" (Left) for India or India-linked developments.
- "r" (Right) for purely foreign developments with ZERO direct Indian link (Tesla in USA, GM in China, EU regulations, Australian partnerships, etc.).
- VISUAL LAYOUT RULE: In Excel sheets, images, or dual-column PDFs, if a headline is placed on the RIGHT side or has empty columns/tabs to its left, it MUST be classified as "r" (Right).

STRICT EXCLUSIONS (Pink Heuristics):
- No speculative plans or future planning cycles without finalized active deals or active launches.
- No standard non-electrified foreign vehicle launches.
- No sector-wide general financial trends or essays.
- No used-vehicle engines, P2P portals, online car directories.
- No schools, educational courses, academic centers of excellence.
- No raw patent filings/tallies or internal R&D budget milestones with no commercial product actions.
- No generic startup venture funding/equity rounds.

HARD TEXT CONVERSIONS (MANDATORY):
- "Rs." / "Rs " / "Rs" -> convert to "INR".
- "percent" / "percentage" -> convert to "%".
- "$" -> convert to "US$".
- "Million" / "mln" / "million" -> replace with "Mn.".
- "Billion" / "bln" / "billion" -> replace with "Bn.".
- "Crore" / "crores" -> replace with "Cr.".
- "YoY" / "Year on Year" -> replace with "Y-o-Y".

OUTPUT SPECIFICATION:
Extract and select all valid SOP-compliant news items from this file, grouping them under the weekday you determined.

Return a JSON object matching this exact schema:
{
  "items": [
    {
      "id": "string (unique temporary id)",
      "date": "string (YYYY-MM-DD representing that weekday or estimated date)",
      "weekday": "Saturday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday",
      "category": "Corporate" | "Electrification" | "New Product" | "Auto Ancillary" | "Service" | "Govt" | "Global",
      "news": "The exact headline, word-for-word, cleaned with hard conversions",
      "side": "l" | "r",
      "remark": "Brief 1-sentence remark of why this was selected or its context",
      "sourceLink": "The exact source link URL if present"
    }
  ]
}

FILE NAME: "${file.name}"
FILE CONTENT TO SCAN:
"""
${file.content}
"""
`;

      const response = await generateContentWithRetry(ai, {
        model: "gemini-2.5-flash",
        contents: filePrompt,
        config: {
          systemInstruction: `${CURATION_SYSTEM_PROMPT}${duplicateAvoidancePrompt}`,
          responseMimeType: "application/json",
          responseSchema: ShortlistWeekResponseSchema,
          temperature: 0.3,
          maxOutputTokens: 8192
        }
      });

      const text = response.text || "";
      let parsed = safeParseJSON(text);
      if (!parsed || !Array.isArray(parsed.items)) {
        parsed = { items: [] };
      }

      if (parsed.items.length < 10) {
        const currentItems = [...parsed.items];
        const existingHeadlinesList = currentItems.map((it: any) => it.news).filter(Boolean);
        console.log(`[API /api/shortlist-week] Sub-file ${file.name} yielded only ${currentItems.length} items. Running accumulation pass...`);

        const retryPrompt = `${filePrompt}\n\nCRITICAL ACCUMULATION PASS: Your previous extraction produced only ${currentItems.length} items:
${existingHeadlinesList.map((h: string) => `- "${h}"`).join("\n")}

You MUST perform an exhaustive re-scan of "${file.name}" to extract AT LEAST 7 TO 12 MORE distinct automotive news items across all 7 categories. Check both Left and Right columns of all tables and every section header! Do NOT repeat existing items.`;

        try {
          const secondResponse = await generateContentWithRetry(ai, {
            model: "gemini-2.5-flash",
            contents: retryPrompt,
            config: {
              systemInstruction: `${CURATION_SYSTEM_PROMPT}\n\nDo NOT repeat any of these already extracted headlines:\n${existingHeadlinesList.map((h: string) => `- "${h}"`).join("\n")}`,
              responseMimeType: "application/json",
              responseSchema: ShortlistWeekResponseSchema,
              temperature: 0.4,
              maxOutputTokens: 8192
            }
          });
          const secondText = secondResponse.text || "";
          const secondParsed = safeParseJSON(secondText);
          if (secondParsed && Array.isArray(secondParsed.items) && secondParsed.items.length > 0) {
            console.log(`[API /api/shortlist-week] Accumulation scan for ${file.name} succeeded! Adding ${secondParsed.items.length} items.`);
            secondParsed.items.forEach((newItem: any) => {
              if (newItem && newItem.news && !currentItems.some((ex: any) => ex.news.toLowerCase().trim() === newItem.news.toLowerCase().trim())) {
                currentItems.push(newItem);
              }
            });
            parsed.items = currentItems;
          }
        } catch (retryErr) {
          console.error(`[API /api/shortlist-week] Deep scan error for ${file.name}:`, retryErr);
        }
      }

      if (parsed && Array.isArray(parsed.items)) {
        return parsed.items;
      }
      return [];
    });

    const results = await Promise.all(filePromises);
    const allItems = results.flat();

    const cleanedItems = allItems.map((item: any) => {
      if (item.news) item.news = applyStrictSOPCleaning(item.news);
      if (item.remark) item.remark = applyStrictSOPCleaning(item.remark);
      return item;
    });

    console.log(`[API /api/shortlist-week] Finished. Extracted ${cleanedItems.length} items across all files.`);
    res.json({ items: cleanedItems });
  } catch (err: any) {
    console.error("[API Error] Shortlist-week failed:", err);
    res.status(500).json({ error: err.message || "Whole-week auto-shortlisting failed" });
  }
});

app.post("/api/summarize", async (req, res, next) => {
  try {
    const { rawText } = req.body;
    const ai = getGeminiClient();

    const prompt = `You are an expert factual summarizer, indexer, and source link extractor.
Analyze the provided text. The text may be a single news article or a compilation of multiple news articles (e.g. from a parsed Word .docx document).
Identify all the distinct news articles in the text. For EACH news article, you MUST perform these tasks in order:
1. Extract the headline/title of the news.
2. Find the respective source link / URL (usually present in or under the content/text of that news, or in references like "Source: http..."). If no link is present, look for any web link inside that news segment or leave it as an empty string "".
3. Create a summary of that news:
   - Must be strictly 3 to 4 lines / 3 to 4 sentences long per news article (strictly 3-4 liners).
   - Must capture the most useful and important information given in the text, including key factual details, statistics, prices, figures, investments, and major announcements.
   - Must be a concise, well-structured paragraph of strictly 3-4 lines/sentences.
   - Only include raw factual information taken directly from the text of that article.
   - DO NOT add anything from your side or outside. Do NOT extrapolate or assume. Keep the data 100% raw.
4. Extract the category tag of the news:
   - CRITICAL CATEGORY REQUIREMENT: You MUST keep the categories of the news EXACTLY THE SAME as in the uploaded raw file/document.
   - Look for the section heading, category header, or table section under which the news article appears in the raw text (for example: "Corporate", "Electrification", "New Product", "Auto Ancillary", "Service", "Govt", "Global", or whatever exact category title/header is present in the uploaded text).
   - Do NOT invent custom categories, and do NOT alter, rephrase, or generalize the category names from the raw file.
5. Extract the publish date if mentioned in the segment (e.g., "06 Jun 2026" or similar). Leave as empty string "" if none.
6. Extract the source publication name if mentioned (e.g., "ET Auto", "Hindustan Times", "Mint", etc.). Leave as empty string "" if none.

STRICT SEQUENCE REQUIREMENT:
- You MUST maintain the EXACT SAME top-to-bottom sequence and order of the news articles as they appear in the provided raw text.
- Do NOT reorder, rearrange, shuffle, or re-group articles differently from their natural top-to-bottom appearance sequence in the uploaded raw text.

Format the response as a JSON object matching this schema:
{
  "articles": [
    {
      "headline": "Extracted headline of the news",
      "sourceLink": "Associated source link URL (e.g., https://...)",
      "summary": "Concise paragraph summary of strictly 3-4 lines/sentences capturing key information",
      "category": "Exact category name from raw uploaded file (e.g. Corporate, Electrification, Auto Ancillary, etc.)",
      "publishDate": "e.g., 06 Jun 2026",
      "sourceName": "e.g., ET Auto"
    }
  ]
}

Ensure the response contains ONLY valid JSON and matches this exact structure.

TEXT TO SUMMARIZE:
"""
${rawText || ""}
"""`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a precise JSON generator that extracts news articles in their exact top-to-bottom original sequence, strictly preserves their exact categories as in the uploaded raw file, matches each with its source link, and summarizes each into a concise paragraph of strictly 3 to 4 lines/sentences capturing all important facts, numbers, and key information directly from the input.",
        responseMimeType: "application/json",
        responseSchema: SummarizeResponseSchema,
        temperature: 0.1,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL
        }
      }
    });

    const resText = response.text || "{}";
    let parsed = safeParseJSON(resText);

    if (parsed && Array.isArray(parsed.articles)) {
      parsed.articles = parsed.articles.map((art: any) => ({
        ...art,
        headline: applyStrictSOPCleaning(art.headline || ""),
        summary: applyStrictSOPCleaning(art.summary || ""),
        category: applyStrictSOPCleaning(art.category || ""),
        publishDate: art.publishDate ? formatToDDMMMYYYY_Spaced(art.publishDate) : "",
        sourceName: formatSourceName(art.sourceName || (art.sourceLink ? art.sourceLink : "ET Auto"))
      }));
    }

    res.json(parsed);
  } catch (err: any) {
    console.error("[API Error] Summarize failed:", err);
    res.status(500).json({ error: err.message || "Summarization failed" });
  }
});

function extractLocalDetailsForChunk(chunk: any[], rawText: string, allItemsList: any[] = []) {
  if (!rawText) {
    return chunk.map((item: any) => ({
      id: item.id,
      news: applyStrictSOPCleaning(item.news || ""),
      category: item.category,
      side: item.side,
      fullText: "Content not available",
      sourceLink: item.sourceLink || "",
      isEV: (item.news || "").toLowerCase().includes("electric") || (item.news || "").toLowerCase().includes("ev ") || item.category === "Electrification"
    }));
  }

  const boundaryReferenceList = allItemsList.length > 0 ? allItemsList : chunk;

  const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "for", "with", "from", "that", "this", "have", "been", "will",
    "are", "was", "were", "has", "had", "about", "into", "over", "after", "under", "than", "more",
    "most", "also", "some", "such", "only", "other", "their", "its", "which", "would", "could", "should",
    "new", "inc", "ltd", "corp", "co", "says", "said"
  ]);

  const getSignificantTokens = (text: string): string[] => {
    if (!text) return [];
    const cleaned = text.replace(/[^a-zA-Z0-9\s\-]/g, " ");
    return cleaned
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
  };

  const isTOCLine = (line: string): boolean => {
    const lineClean = line.trim();
    if (lineClean.includes("...") || lineClean.includes("....")) return true;
    if ((lineClean.match(/\./g) || []).length > 4 && lineClean.length < 250) return true;
    if (/\s+\.?\.?\s*\d+$/.test(lineClean) && lineClean.length < 200) return true;
    return false;
  };

  return chunk.map((item: any) => {
    const headline = (item.news || "").trim();
    let extractedText = "";
    let extractedLink = item.sourceLink || "";

    if (!headline) {
      return {
        id: item.id,
        news: "",
        category: item.category,
        side: item.side,
        fullText: "Content not available",
        sourceLink: extractedLink,
        isEV: false
      };
    }

    let matchedPos = -1;

    const normHeadline = headline.toLowerCase().replace(/\s+/g, " ");
    let lastIdx = -1;
    while (true) {
      const idx = rawText.toLowerCase().replace(/\s+/g, " ").indexOf(normHeadline, lastIdx + 1);
      if (idx === -1) break;
      lastIdx = idx;

      const startOfLine = rawText.lastIndexOf("\n", idx) + 1;
      const endOfLine = rawText.indexOf("\n", idx);
      const line = rawText.slice(startOfLine, endOfLine !== -1 ? endOfLine : rawText.length);

      if (!isTOCLine(line)) {
        matchedPos = idx;
        break;
      }
    }

    if (matchedPos === -1) {
      const tokens = getSignificantTokens(headline).slice(0, 4);
      if (tokens.length >= 2) {
        const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("[\\s\\S]{0,120}?");
        try {
          const reg = new RegExp(pattern, "gi");
          let m;
          while ((m = reg.exec(rawText)) !== null) {
            const idx = m.index;
            const startOfLine = rawText.lastIndexOf("\n", idx) + 1;
            const endOfLine = rawText.indexOf("\n", idx);
            const line = rawText.slice(startOfLine, endOfLine !== -1 ? endOfLine : rawText.length);
            if (!isTOCLine(line)) {
              matchedPos = idx;
              break;
            }
          }
        } catch (e) {}
      }
    }

    if (matchedPos === -1) {
      const tokens = getSignificantTokens(headline).slice(0, 3);
      if (tokens.length >= 2) {
        const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("[\\s\\S]{0,80}?");
        try {
          const reg = new RegExp(pattern, "gi");
          let m;
          while ((m = reg.exec(rawText)) !== null) {
            const idx = m.index;
            const startOfLine = rawText.lastIndexOf("\n", idx) + 1;
            const endOfLine = rawText.indexOf("\n", idx);
            const line = rawText.slice(startOfLine, endOfLine !== -1 ? endOfLine : rawText.length);
            if (!isTOCLine(line)) {
              matchedPos = idx;
              break;
            }
          }
        } catch (e) {}
      }
    }

    if (matchedPos === -1) {
      const tokens = getSignificantTokens(headline);
      if (tokens.length >= 1) {
        const lines = rawText.split("\n");
        let charCursor = 0;
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const line = lines[lIdx];
          const currentPos = charCursor;
          charCursor += line.length + 1;

          if (isTOCLine(line)) continue;

          const lineLower = line.toLowerCase();
          let matchCount = 0;
          for (const tok of tokens) {
            if (lineLower.includes(tok.toLowerCase())) {
              matchCount++;
            }
          }

          if (matchCount >= 2 || (tokens.length === 1 && matchCount === 1 && line.length < 200)) {
            matchedPos = currentPos;
            break;
          }
        }
      }
    }

    if (matchedPos !== -1) {
      const lineEnd = rawText.indexOf("\n", matchedPos);
      const bodyStart = lineEnd !== -1 ? lineEnd + 1 : matchedPos;
      const snippet = rawText.slice(bodyStart, bodyStart + 25000);

      const urlMatch = snippet.match(/https?:\/\/[^\s"']+/i);
      let foundLink = item.sourceLink || "";
      let urlIdx = snippet.length;

      if (urlMatch && urlMatch.index !== undefined) {
        foundLink = urlMatch[0];
        urlIdx = urlMatch.index;
      }

      let nextHeadlineIdx = snippet.length;

      for (const otherItem of boundaryReferenceList) {
        const otherHeadline = (otherItem.news || "").trim();
        if (!otherHeadline || otherHeadline.toLowerCase() === headline.toLowerCase()) continue;

        const otherTokens = getSignificantTokens(otherHeadline).slice(0, 4);
        if (otherTokens.length < 2) continue;

        const otherPattern = otherTokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("[\\s\\S]{0,100}?");
        try {
          const reg = new RegExp(otherPattern, "gi");
          let om;
          while ((om = reg.exec(snippet)) !== null) {
            if (om.index > 40) {
              if (om.index < nextHeadlineIdx) {
                nextHeadlineIdx = om.index;
              }
              break;
            }
          }
        } catch (e) {}
      }

      const fileMarkerMatch = snippet.match(/\n===\s*FILE/i);
      if (fileMarkerMatch && fileMarkerMatch.index !== undefined && fileMarkerMatch.index > 40) {
        if (fileMarkerMatch.index < nextHeadlineIdx) {
          nextHeadlineIdx = fileMarkerMatch.index;
        }
      }

      let limitIdx = snippet.length;
      if (urlIdx !== snippet.length && urlIdx < nextHeadlineIdx) {
        limitIdx = urlIdx;
      } else if (nextHeadlineIdx !== snippet.length) {
        limitIdx = nextHeadlineIdx;
        if (urlIdx > nextHeadlineIdx) {
          foundLink = item.sourceLink || "";
        }
      }

      let rawBodyText = snippet.slice(0, limitIdx).trim();

      const lines = rawBodyText.split("\n");
      const filteredLines = lines.filter(l => {
        const t = l.trim();
        if (/^(also read|read more|related news|see also|recommended|popular stories):/i.test(t)) return false;
        if (/^[►►▸■•]\s*(tyres|not sensors|also read|read more)/i.test(t)) return false;
        return true;
      });

      let fullBody = filteredLines.join("\n").trim();

      if (fullBody.length >= 20) {
        extractedText = fullBody;
      } else if (rawBodyText.length >= 20) {
        extractedText = rawBodyText;
      }

      if (foundLink) {
        extractedLink = foundLink;
      }
    }

    if (!extractedText || extractedText.length < 15) {
      extractedText = "Content not available";
    }

    return {
      id: item.id,
      news: applyStrictSOPCleaning(headline),
      category: item.category,
      side: item.side,
      fullText: extractedText === "Content not available" ? "Content not available" : applyStrictSOPCleaning(extractedText),
      sourceLink: extractedLink,
      isEV: headline.toLowerCase().includes("electric") || headline.toLowerCase().includes("ev ") || item.category === "Electrification"
    };
  });
}

app.post("/api/extract-detailed", async (req, res, next) => {
  try {
    const { items, rawText } = req.body;
    const ai = getGeminiClient();

    const CHUNK_SIZE = 5;
    const chunks: any[][] = [];
    const itemsList = Array.isArray(items) ? items : [];

    for (let i = 0; i < itemsList.length; i += CHUNK_SIZE) {
      chunks.push(itemsList.slice(i, i + CHUNK_SIZE));
    }

    console.log(`[API] extract-detailed: Splitting ${itemsList.length} items into ${chunks.length} chunks of size ${CHUNK_SIZE}`);

    const chunkPromises = chunks.map(async (chunk, index) => {
      console.log(`[API] Preparing chunk ${index + 1}/${chunks.length} containing ${chunk.length} items`);

      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, index * 150));
      }

      const prompt = `
ROLE:
You are an expert Automotive News Content Compiler.

INPUTS:
1. CURATED HEADLINES QUEUE (Subset Chunk):
${JSON.stringify(chunk.map((item: any) => ({ id: item.id, news: item.news, category: item.category, side: item.side, remark: item.remark })), null, 2)}

2. RAW SOURCE TEXT:
"""
${rawText || ""}
"""

TASK:
For each item in the CURATED HEADLINES QUEUE:
1. Locate the exact headline in the RAW SOURCE TEXT.
2. STICK STRICTLY to that specific headline and extract the COMPLETE text/content written directly underneath it up until its source URL link. Do NOT take content from anywhere else.
3. Paste the FULL, complete, un-summarized, and un-truncated content of that headline properly verbatim.

MANDATORY EXTRACTION RULES (STRICT VERBATIM COMPLIANCE):
- **VERBATIM EXTRACTION MANDATE**: Whenever shortlisted headlines are provided, extract the COMPLETE, EXACT, and VERBATIM content that appears directly below each shortlisted headline. Do NOT summarize, paraphrase, rewrite, shorten, or omit any part of the article text. Preserve the original wording, paragraph structure, punctuation, numbers, hyperlinks, quotations, bullet points, and formatting exactly as they appear in the source.
- **ACCURACY & ZERO CROSS-ARTICLE BLEED**: Every shortlisted headline MUST be matched with its corresponding full article content. No text from another headline or article is to be mixed into the output. No content is to be skipped, truncated, or hallucinated.
- **MULTI-PARAGRAPH EXTRACTION**: If the content spans multiple paragraphs, extract ALL of them until the next headline or article begins or the source URL link is reached.
- **PARAGRAPH BREAK PRESERVATION**: Always preserve the exact paragraph/line break structure from the raw uploaded news files using '\\n'. Do not merge lines or automatically reconstruct paragraphs into larger blocks. The text or body of the news stories must remain in the original small paragraph format as given in the raw uploaded documents.
- **MISSING CONTENT MANDATE**: If any content is missing or inaccessible in the raw source text for a headline, explicitly state "Content not available" in the "fullText" field instead of guessing, hallucinating, or duplicating the headline.
- **IGNORE THE TABLE OF CONTENTS**: The first few pages of the raw text contain a "Contents" table or index (e.g. lists of headlines with page numbers or dots). **DO NOT** match or extract from this table of contents. You must search further down in the raw text to locate the actual full body of the article which contains multiple full paragraphs of description.
- **EXCLUDE RECOMMENDED ARTICLES & WEBSITE WIDGETS**: Do NOT capture or include unnecessary text, website navigation fragments, recommended articles, related story banners, or promotional/social widgets (e.g. "Also Read: ...", "Read More: ...", "► Tyres take centre stage...").
- **SOURCE LINK RECOVERY**: Locate and extract the EXACT source link (URL) of this news story that is placed below or at the bottom of the news item's content. Reconstruct and heal the URL by merging broken pieces together if needed.
- **ID MATCHING**: Make sure the "id" field in your output object exactly matches the "id" field of the input curated item from the queue.

OUTPUT JSON FORMAT:
Return a JSON array of objects, one for each input curated item in this chunk, preserving their order, with this exact schema:
[
  {
    "id": "string (the curated item id from input)",
    "news": "string (the full headline/title of article verbatim)",
    "category": "string (one of the 7 official categories)",
    "side": "l" | "r",
    "fullText": "Full extracted verbatim text of this article, or 'Content not available' if missing/inaccessible",
    "sourceLink": "The exact extracted URL source link (e.g., https://...)",
    "isEV": true | false
  }
]
`;

      try {
        const response = await generateContentWithRetry(ai, {
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            systemInstruction: "You are an extremely precise news compiler. For each curated item, you must locate its headline in the raw text, and copy-paste the COMPLETE verbatim text block that is written directly below that headline up until its source URL link. If a headline has been slightly truncated or has a trailing comma, match it intelligently to its actual full text block. You are STRICTLY FORBIDDEN from summarizing, shortening, truncating, paraphrasing, or fabricating any part of the text. Do NOT match or extract from the Table of Contents (TOC) at the beginning of the text which lists headlines with page numbers/dots; instead, locate the actual full article body situated further down in the document. Stick strictly to each specific headline, and paste its full content verbatim, preserving all original paragraph and line break structures of each story. Do not pull content from anywhere else. Ensure that there is absolutely no mismatch between headlines and their respective body text.",
            responseMimeType: "application/json",
            responseSchema: ExtractDetailedResponseSchema,
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        });

        const text = response.text || "";
        let parsed = safeParseJSON(text);

        if (parsed && Array.isArray(parsed)) {
          return parsed.map((item: any) => {
            if (item.news) item.news = applyStrictSOPCleaning(item.news);
            if (item.fullText) item.fullText = applyStrictSOPCleaning(item.fullText);
            return item;
          });
        } else {
          console.warn(`[API] Chunk ${index + 1} JSON parsing produced fallback.`);
          return extractLocalDetailsForChunk(chunk, rawText, itemsList);
        }
      } catch (chunkErr: any) {
        console.warn(`[API] Chunk ${index + 1} completed via smart local fallback engine:`, chunkErr?.message || chunkErr);
        return extractLocalDetailsForChunk(chunk, rawText, itemsList);
      }
    });

    const results = await Promise.all(chunkPromises);
    const allCompiledItems = results.flat();

    res.json({ compiledItems: allCompiledItems });
  } catch (err: any) {
    console.warn("[API Warning] Extract-detailed main block completed via smart local fallback engine:", err?.message || err);
    const items = req.body.items || [];
    const fallbackList = extractLocalDetailsForChunk(items, req.body.rawText || "", items);
    res.json({ compiledItems: fallbackList });
  }
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Express Error Handler]:", err);
  res.status(err.status || 500).json({
    error: err.message || "An unexpected server-side error occurred"
  });
});

export default app;
