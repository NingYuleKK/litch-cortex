/**
 * Conversations Page — V0.8
 *
 * Four areas:
 *   A. Import Area — drag & drop .json upload
 *   B. Import Progress — real-time progress polling
 *   C. Conversation List — paginated table
 *   D. Import History — past imports
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Upload, MessageSquare, Loader2, CheckCircle, XCircle,
  FileJson, Clock, Hash, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";

// ─── Upload helper ──────────────────────────────────────────────
async function uploadConversationsFile(
  file: File,
  projectId: number,
): Promise<{ importLogId: number; status: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId", String(projectId));

  const response = await fetch("/api/upload/conversations", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Upload failed (HTTP ${response.status})`);
  }
  return data;
}

// ─── Status badges ──────────────────────────────────────────────
const importStatusMap: Record<string, { label: string; color: string }> = {
  running: { label: "导入中", color: "bg-blue-500/20 text-blue-400" },
  completed: { label: "完成", color: "bg-green-500/20 text-green-400" },
  failed: { label: "失败", color: "bg-red-500/20 text-red-400" },
  cancelled: { label: "已取消", color: "bg-yellow-500/20 text-yellow-400" },
};

const convStatusMap: Record<string, { label: string; color: string }> = {
  importing: { label: "导入中", color: "bg-blue-500/20 text-blue-400" },
  done: { label: "已完成", color: "bg-green-500/20 text-green-400" },
  error: { label: "错误", color: "bg-red-500/20 text-red-400" },
};

export default function ConversationsPage({ projectId }: { projectId: number }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeImportLogId, setActiveImportLogId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Queries ──────────────────────────────────────────────────
  const { data: conversationList, refetch: refetchConversations } = trpc.conversation.list.useQuery(
    { projectId, page, pageSize: 20 },
  );

  const { data: importHistory, refetch: refetchHistory } = trpc.conversation.importHistory.useQuery(
    { projectId, limit: 10 },
  );

  // Progress polling — only when an import is active
  const { data: importProgress } = trpc.conversation.importProgress.useQuery(
    { importLogId: activeImportLogId! },
    {
      enabled: activeImportLogId !== null,
      refetchInterval: 2000,
    },
  );

  // Stop polling when import is done
  useEffect(() => {
    if (importProgress && (importProgress.status === "completed" || importProgress.status === "failed")) {
      // Keep polling for a moment to show final state, then stop
      const timer = setTimeout(() => {
        setActiveImportLogId(null);
        refetchConversations();
        refetchHistory();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [importProgress, refetchConversations, refetchHistory]);

  // ─── Upload handlers ──────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".json")) {
      toast.error("Only .json files are supported");
      return;
    }

    setUploading(true);
    try {
      const result = await uploadConversationsFile(file, projectId);
      setActiveImportLogId(result.importLogId);
      toast.success("Import started");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [projectId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* A. Import Area */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-cyan-400" />
            对话导入
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-cyan-400 bg-cyan-400/5"
                : "border-muted-foreground/25 hover:border-cyan-400/50"
            }`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                <p className="text-sm text-muted-foreground">上传中...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FileJson className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  拖拽 ChatGPT <code>conversations.json</code> 到此处，或点击选择文件
                </p>
                <p className="text-xs text-muted-foreground/60">
                  支持增量导入，重复对话自动跳过
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* B. Import Progress */}
      {importProgress && activeImportLogId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className={`h-4 w-4 ${importProgress.status === "running" ? "animate-spin" : ""} text-cyan-400`} />
              导入进度
              <Badge variant="outline" className={importStatusMap[importProgress.status]?.color || ""}>
                {importStatusMap[importProgress.status]?.label || importProgress.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Progress bar */}
            <div className="mb-4">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all duration-500"
                  style={{
                    width: importProgress.conversationsTotal > 0
                      ? `${(importProgress.conversationsProcessed / importProgress.conversationsTotal) * 100}%`
                      : "0%",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {importProgress.conversationsProcessed} / {importProgress.conversationsTotal} 对话已处理
              </p>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground text-xs">新导入</div>
                <div className="font-mono font-medium">{importProgress.conversationsImported}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground text-xs">已跳过</div>
                <div className="font-mono font-medium">{importProgress.conversationsSkipped}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground text-xs">已更新</div>
                <div className="font-mono font-medium">{importProgress.conversationsUpdated}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground text-xs">Chunks</div>
                <div className="font-mono font-medium">{importProgress.chunksCreated}</div>
              </div>
            </div>

            {/* Errors */}
            {importProgress.errors && importProgress.errors.length > 0 && (
              <div className="mt-3 p-2 bg-red-500/10 rounded-lg">
                <p className="text-xs text-red-400 font-medium mb-1">Errors:</p>
                {importProgress.errors.slice(0, 5).map((err: string, i: number) => (
                  <p key={i} className="text-xs text-red-400/80 truncate">{err}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* C. Conversation List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-cyan-400" />
              已导入对话
              {conversationList && (
                <Badge variant="outline" className="ml-1">{conversationList.total}</Badge>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!conversationList || conversationList.items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无已导入的对话
            </p>
          ) : (
            <>
              <div className="space-y-2">
                {conversationList.items.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{conv.title || "Untitled"}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          {conv.messageCount} 消息
                        </span>
                        {conv.model && (
                          <span className="font-mono">{conv.model}</span>
                        )}
                        {conv.createTime && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(conv.createTime).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={convStatusMap[conv.status]?.color || ""}
                    >
                      {convStatusMap[conv.status]?.label || conv.status}
                    </Badge>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {conversationList.total > conversationList.pageSize && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page} / {Math.ceil(conversationList.total / conversationList.pageSize)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= Math.ceil(conversationList.total / conversationList.pageSize)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* D. Import History */}
      {importHistory && importHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-cyan-400" />
              导入历史
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {importHistory.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{log.filename}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{log.conversationsImported} 导入</span>
                      <span>{log.conversationsSkipped} 跳过</span>
                      <span>{log.conversationsUpdated} 更新</span>
                      <span>{log.chunksCreated} chunks</span>
                      {log.durationMs && (
                        <span>{(log.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={importStatusMap[log.status]?.color || ""}
                    >
                      {importStatusMap[log.status]?.label || log.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
