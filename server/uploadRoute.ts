/**
 * PDF Upload Route — multipart/form-data via multer
 * 
 * Supports both Manus OAuth and independent Cortex auth.
 * Fixes Chinese filename encoding issue in multipart/form-data.
 */
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";
import { getCortexUser } from "./authRoute";
import {
  createDocument, updateDocument,
  insertChunks,
} from "./db";

// ─── PDF parsing helper ─────────────────────────────────────────────
async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

// ─── Text chunking helper ───────────────────────────────────────────
function chunkText(text: string, minSize = 500, maxSize = 800): string[] {
  const results: string[] = [];
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let current = "";
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (current.length + trimmed.length + 1 <= maxSize) {
      current = current ? current + "\n\n" + trimmed : trimmed;
    } else {
      if (current.length >= minSize) {
        results.push(current);
        current = trimmed;
      } else if (current.length + trimmed.length + 1 <= maxSize * 1.2) {
        current = current ? current + "\n\n" + trimmed : trimmed;
      } else {
        if (current) results.push(current);
        current = trimmed;
      }
    }
  }
  if (current) results.push(current);

  const finalResults: string[] = [];
  for (const chunk of results) {
    if (chunk.length <= maxSize * 1.5) {
      finalResults.push(chunk);
    } else {
      const sentences = chunk.split(/(?<=[。！？.!?])\s*/);
      let sub = "";
      for (const sent of sentences) {
        if (sub.length + sent.length + 1 <= maxSize) {
          sub = sub ? sub + sent : sent;
        } else {
          if (sub) finalResults.push(sub);
          sub = sent;
        }
      }
      if (sub) finalResults.push(sub);
    }
  }

  return finalResults.length > 0 ? finalResults : [text.slice(0, maxSize)];
}

// Export for testing
export { chunkText, parsePdfBuffer };

/**
 * Fix Chinese filename encoding in multipart/form-data.
 * 
 * When browsers send multipart requests, non-ASCII filenames may be:
 * 1. RFC 5987 encoded (filename*=UTF-8''...) — multer handles this
 * 2. Raw UTF-8 bytes misinterpreted as Latin-1 — needs manual fix
 * 3. Percent-encoded — needs decoding
 */
function fixFilename(rawName: string): string {
  if (!rawName) return "unnamed.pdf";

  // Try to detect if the string is Latin-1 encoded UTF-8 (mojibake)
  // This happens when UTF-8 bytes are interpreted as Latin-1
  try {
    // Check if the string contains typical mojibake patterns (high bytes)
    const hasHighBytes = /[\u0080-\u00ff]{2,}/.test(rawName);
    if (hasHighBytes) {
      // Convert Latin-1 string back to UTF-8
      const bytes = new Uint8Array(rawName.length);
      for (let i = 0; i < rawName.length; i++) {
        bytes[i] = rawName.charCodeAt(i);
      }
      const decoded = new TextDecoder("utf-8").decode(bytes);
      // Verify the decoded string looks reasonable (contains CJK or other expected chars)
      if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(decoded)) {
        return decoded;
      }
    }
  } catch {
    // Fall through to return raw name
  }

  // Try percent-decoding
  try {
    const decoded = decodeURIComponent(rawName);
    if (decoded !== rawName) return decoded;
  } catch {
    // Not percent-encoded
  }

  return rawName;
}

// ─── Multer config (memory storage, 100MB limit) ────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// ─── Auth helper: try cortex auth first, then Manus OAuth ──────────
async function authenticateRequest(req: any): Promise<{ id: number; type: "cortex" | "manus" } | null> {
  // Try Cortex independent auth first
  const cortexUser = await getCortexUser(req);
  if (cortexUser) {
    return { id: cortexUser.id, type: "cortex" };
  }

  // Fall back to Manus OAuth
  try {
    const manusUser = await sdk.authenticateRequest(req);
    if (manusUser) {
      return { id: manusUser.id, type: "manus" };
    }
  } catch {
    // Manus auth failed
  }

  return null;
}

// ─── Router ─────────────────────────────────────────────────────────
const uploadRouter = Router();

uploadRouter.post(
  "/api/upload/pdf",
  upload.single("file"),
  async (req, res) => {
    try {
      // 1. Authenticate
      const authResult = await authenticateRequest(req);
      if (!authResult) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // 2. Validate file
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      // 3. Fix filename encoding
      const filename = fixFilename(file.originalname);
      const projectId = req.body.projectId ? parseInt(req.body.projectId) : null;

      console.log(`[Upload] Processing "${filename}" (${(file.size / 1024 / 1024).toFixed(1)}MB) for ${authResult.type} user ${authResult.id}`);

      // 4. Upload to S3
      const fileKey = `cortex/${authResult.id}/pdfs/${nanoid()}-${filename}`;
      const { url: fileUrl } = await storagePut(fileKey, file.buffer, "application/pdf");

      // 5. Create document record
      const docId = await createDocument({
        userId: authResult.id,
        projectId,
        filename,
        fileUrl,
        status: "parsing",
      });

      // 6. Parse PDF
      try {
        const rawText = await parsePdfBuffer(file.buffer);
        
        if (!rawText || rawText.trim().length === 0) {
          await updateDocument(docId, { status: "error", rawText: "" });
          res.status(422).json({ 
            error: "PDF contains no extractable text. It may be a scanned/image-only PDF.",
            id: docId,
            chunkCount: 0,
          });
          return;
        }

        const textChunks = chunkText(rawText);

        // 7. Insert chunks
        const chunkData = textChunks.map((content, idx) => ({
          documentId: docId,
          content,
          position: idx,
          tokenCount: content.length,
        }));
        await insertChunks(chunkData);

        // 8. Update document
        await updateDocument(docId, {
          rawText,
          status: "done",
          chunkCount: textChunks.length,
        });

        console.log(`[Upload] "${filename}" parsed: ${textChunks.length} chunks`);

        res.json({
          id: docId,
          filename,
          chunkCount: textChunks.length,
          status: "done",
          textLength: rawText.length,
        });
      } catch (err: any) {
        console.error(`[Upload] PDF parsing failed for "${filename}":`, err.message);
        await updateDocument(docId, { status: "error" });
        res.status(422).json({
          error: `PDF parsing failed: ${err.message}`,
          id: docId,
          chunkCount: 0,
        });
      }
    } catch (err: any) {
      console.error("[Upload] Error:", err.message);
      if (err.message?.includes("Forbidden") || err.message?.includes("session")) {
        res.status(401).json({ error: "Unauthorized" });
      } else {
        res.status(500).json({ error: err.message || "Internal server error" });
      }
    }
  }
);

export default uploadRouter;
