/**
 * Conversation Upload Route — V0.8
 *
 * Accepts ChatGPT conversations.json via multipart/form-data.
 * Follows the same pattern as uploadRoute.ts (PDF upload).
 */
import { Router } from "express";
import multer from "multer";
import { getCortexUser } from "./authRoute";
import { importConversationsJson } from "./import-service";

// ─── Multer config (memory storage, 500MB limit, .json only) ────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
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

conversationUploadRouter.post(
  "/api/upload/conversations",
  upload.single("file"),
  async (req, res) => {
    try {
      // 1. Authenticate (Cortex auth only — no Manus fallback)
      const cortexUser = await getCortexUser(req);
      if (!cortexUser) {
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
        res.status(400).json({ error: "projectId is required" });
        return;
      }

      console.log(
        `[ConversationUpload] Processing "${file.originalname}" (${(file.size / 1024 / 1024).toFixed(1)}MB) for user ${cortexUser.id} in project ${projectId}`,
      );

      // 4. Start async import — returns immediately with importLogId
      const importLogId = await importConversationsJson({
        buffer: file.buffer,
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
      console.error("[ConversationUpload] Error:", err.message);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  },
);

export default conversationUploadRouter;
