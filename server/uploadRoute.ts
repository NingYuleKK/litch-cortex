/**
 * PDF Upload Route — multipart/form-data via multer
 * 
 * Replaces the old Base64-in-tRPC approach to handle large PDFs (>10MB)
 * that exceed the gateway's JSON body size limit.
 */
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";
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

// ─── Router ─────────────────────────────────────────────────────────
const uploadRouter = Router();

uploadRouter.post(
  "/api/upload/pdf",
  upload.single("file"),
  async (req, res) => {
    try {
      // 1. Authenticate
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // 2. Validate file
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const filename = file.originalname || "unnamed.pdf";
      const projectId = req.body.projectId ? parseInt(req.body.projectId) : null;

      console.log(`[Upload] Processing ${filename} (${(file.size / 1024 / 1024).toFixed(1)}MB) for user ${user.id}`);

      // 3. Upload to S3
      const fileKey = `cortex/${user.id}/pdfs/${nanoid()}-${filename}`;
      const { url: fileUrl } = await storagePut(fileKey, file.buffer, "application/pdf");

      // 4. Create document record
      const docId = await createDocument({
        userId: user.id,
        projectId,
        filename,
        fileUrl,
        status: "parsing",
      });

      // 5. Parse PDF
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

        // 6. Insert chunks
        const chunkData = textChunks.map((content, idx) => ({
          documentId: docId,
          content,
          position: idx,
          tokenCount: content.length,
        }));
        await insertChunks(chunkData);

        // 7. Update document
        await updateDocument(docId, {
          rawText,
          status: "done",
          chunkCount: textChunks.length,
        });

        console.log(`[Upload] ${filename} parsed: ${textChunks.length} chunks`);

        res.json({
          id: docId,
          chunkCount: textChunks.length,
          status: "done",
          textLength: rawText.length,
        });
      } catch (err: any) {
        console.error(`[Upload] PDF parsing failed for ${filename}:`, err.message);
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
