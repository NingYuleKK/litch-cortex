/**
 * Conversation Upload Route — V0.8
 *
 * Accepts ChatGPT conversations.json via multipart/form-data.
 * Uses disk storage (not memory) to avoid OOM on large files.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import multer, { MulterError } from "multer";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { getCortexUser } from "./authRoute";
import { importConversationsJson } from "./import-service";

// ─── Multer config (disk storage, 500MB limit, .json only) ─────
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      const unique = `cortex-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 1 * 1024 * 1024 * 1024 }, // 1GB
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/json" ||
      file.originalname.endsWith(".json")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .json files are allowed"));
    }
  },
});

// ─── Router ─────────────────────────────────────────────────────
const conversationUploadRouter = Router();

// Multer error handler — returns 413 for file size limit
function handleMulterError(err: Error, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "文件超过 1GB 限制" });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message });
    return;
  }
  next();
}

conversationUploadRouter.post(
  "/api/upload/conversations",
  upload.single("file"),
  handleMulterError,
  async (req: Request, res: Response) => {
    try {
      // 1. Authenticate (Cortex auth only — no Manus fallback)
      const cortexUser = await getCortexUser(req);
      if (!cortexUser) {
        // Clean up temp file written by multer before auth check
        if (req.file?.path) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // 2. Validate file
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      // 3. Validate projectId
      const projectId = req.body.projectId ? parseInt(req.body.projectId) : null;
      if (!projectId || isNaN(projectId)) {
        // Clean up temp file
        await fs.unlink(file.path).catch(() => {});
        res.status(400).json({ error: "projectId is required" });
        return;
      }

      console.log(
        `[ConversationUpload] Processing "${file.originalname}" (${(file.size / 1024 / 1024).toFixed(1)}MB) for user ${cortexUser.id} in project ${projectId}`,
      );

      // 4. Start async import — returns immediately with importLogId
      //    Pass file path instead of buffer; import-service will stream from disk
      const importLogId = await importConversationsJson({
        filePath: file.path,
        fileSize: file.size,
        filename: file.originalname,
        projectId,
        cortexUserId: cortexUser.id,
      });

      console.log(`[ConversationUpload] Import started: importLogId=${importLogId}`);

      res.json({
        importLogId,
        status: "running",
        message: "Import started. Use importProgress to track progress.",
      });
    } catch (err: any) {
      // Clean up temp file on error
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      console.error("[ConversationUpload] Error:", err.message);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  },
);

export default conversationUploadRouter;
