import { CurationResult } from "./types";

/**
 * Robust fetch wrapper with automatic exponential backoff retries for transient
 * server bootup states (like "Please wait while your application starts...") and 5xx/429 errors.
 */
export async function robustFetch(
  url: string,
  options: RequestInit,
  maxRetries = 6,
  initialDelay = 1500
): Promise<Response> {
  let attempt = 0;
  let delay = initialDelay;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch(url, options);
      const contentType = response.headers.get("content-type") || "";
      const isHtml = contentType.includes("text/html");

      // Successful JSON/valid response
      if (response.ok && !isHtml) {
        return response;
      }

      // If we got an HTML response (likely from the nginx container startup or proxy warmup)
      if (isHtml) {
        const text = await response.clone().text().catch(() => "");
        if (
          text.includes("Starting Server") ||
          text.includes("Please wait while your application starts") ||
          text.includes("warmup") ||
          response.status >= 500
        ) {
          console.warn(
            `[robustFetch] Received HTML warmup/server starting page (Status ${response.status}) on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 1.5;
          continue;
        }
      }

      // If we got a 429 Rate Limit or 5xx server-side model busy error, retry
      if (!response.ok && (response.status === 429 || response.status >= 500)) {
        console.warn(
          `[robustFetch] Server returned status ${response.status} on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 1.5;
        continue;
      }

      // Return immediately for other status codes (like 400 Bad Request) so caller can handle
      return response;
    } catch (err) {
      console.warn(
        `[robustFetch] Fetch exception occurred on attempt ${attempt}/${maxRetries}:`,
        err
      );
      if (attempt >= maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 1.5;
    }
  }
  throw new Error(`Failed to complete API request to ${url} after ${maxRetries} retries.`);
}

/**
 * Curates news items from raw text or OCR data by calling the server-side API proxy.
 */
export async function curateNews(
  rawText: string, 
  fileName: string,
  inlineData?: { 
    data: string, 
    mimeType: string 
  },
  existingHeadlines?: string[]
): Promise<CurationResult> {
  const response = await robustFetch("/api/curate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawText,
      fileName,
      inlineData,
      existingHeadlines,
    }),
  });

  const contentType = response.headers.get("content-type");
  if (!response.ok) {
    let errMsg = `Server curation failed with status ${response.status}`;
    if (contentType && contentType.includes("application/json")) {
      const errData = await response.json().catch(() => ({}));
      errMsg = errData.error || errMsg;
    } else {
      const text = await response.text().catch(() => "");
      if (text.includes("<!DOCTYPE") || text.includes("<html")) {
        errMsg = `Server returned HTML page (Status ${response.status}). The API server or proxy might be down or restarting.`;
      } else {
        errMsg = text.slice(0, 150) || errMsg;
      }
    }
    throw new Error(errMsg);
  }

  if (!contentType || !contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    console.error("Non-JSON curation response:", text);
    throw new Error(`Expected JSON curation response but received ${contentType || "unknown content"}. Please try again.`);
  }

  const result = await response.json();
  return result as CurationResult;
}

/**
 * Summarizes raw text by calling the server-side API proxy.
 */
export async function summarizeRawText(rawText: string): Promise<string> {
  const response = await robustFetch("/api/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawText,
    }),
  });

  const contentType = response.headers.get("content-type");
  if (!response.ok) {
    let errMsg = `Server summarization failed with status ${response.status}`;
    if (contentType && contentType.includes("application/json")) {
      const errData = await response.json().catch(() => ({}));
      errMsg = errData.error || errMsg;
    } else {
      const text = await response.text().catch(() => "");
      if (text.includes("<!DOCTYPE") || text.includes("<html")) {
        errMsg = `Server returned HTML page (Status ${response.status}). The API server or proxy might be down or restarting.`;
      } else {
        errMsg = text.slice(0, 150) || errMsg;
      }
    }
    throw new Error(errMsg);
  }

  if (!contentType || !contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    console.error("Non-JSON summarization response:", text);
    throw new Error(`Expected JSON summarization response but received ${contentType || "unknown content"}. Please try again.`);
  }

  const data = await response.json();
  return data.summary || "No summary was generated.";
}
