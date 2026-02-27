import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Loader2, CheckCircle, XCircle, Tags, Brain } from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

/**
 * Upload PDF via multipart/form-data to /api/upload/pdf
 * This bypasses tRPC JSON body size limits for large files.
 */
async function uploadPdfFile(
  file: File,
  projectId?: number
): Promise<{ id: number; chunkCount: number; status: string; textLength?: number }> {
  const formData = new FormData();
  formData.append("file", file);
  if (projectId) {
    formData.append("projectId", String(projectId));
  }

  const response = await fetch("/api/upload/pdf", {
    method: "POST",
    body: formData,
    credentials: "include",
    // Do NOT set Content-Type header — browser sets it with boundary automatically
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Upload failed (HTTP ${response.status})`);
  }

  return data;
}

const statusMap: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  uploading: { label: "上传中", color: "bg-yellow-500/20 text-yellow-400", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  parsing: { label: "解析中", color: "bg-blue-500/20 text-blue-400", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  extracting: { label: "提取话题中", color: "bg-purple-500/20 text-purple-400", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  done: { label: "完成", color: "bg-green-500/20 text-green-400", icon: <CheckCircle className="h-3 w-3" /> },
  error: { label: "错误", color: "bg-red-500/20 text-red-400", icon: <XCircle className="h-3 w-3" /> },
};

export default function Home({ projectId }: { projectId?: number }) {
  const [, setLocation] = useLocation();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ file: string; status: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents, refetch: refetchDocs } = trpc.document.list.useQuery(
    projectId ? { projectId } : undefined
  );
  const extractMutation = trpc.extraction.extractDocument.useMutation();

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    if (pdfFiles.length === 0) {
      toast.error("请选择 PDF 文件");
      return;
    }

    setUploading(true);
    const progress: { file: string; status: string }[] = pdfFiles.map(f => ({ file: f.name, status: "uploading" }));
    setUploadProgress([...progress]);

    for (let i = 0; i < pdfFiles.length; i++) {
      const file = pdfFiles[i];
      try {
        progress[i].status = "parsing";
        setUploadProgress([...progress]);

        // Use multipart/form-data upload instead of Base64 tRPC
        const result = await uploadPdfFile(file, projectId);

        if (result.chunkCount === 0) {
          progress[i].status = "error";
          setUploadProgress([...progress]);
          toast.error(`${file.name} 解析出 0 个分段，可能是扫描版 PDF`);
          continue;
        }

        progress[i].status = "extracting";
        setUploadProgress([...progress]);

        try {
          await extractMutation.mutateAsync({ documentId: result.id });
        } catch {
          toast.warning(`${file.name} 话题提取部分失败，可稍后重试`);
        }

        progress[i].status = "done";
        setUploadProgress([...progress]);
        toast.success(`${file.name} 处理完成 (${result.chunkCount} 个分段)`);
      } catch (err: any) {
        progress[i].status = "error";
        setUploadProgress([...progress]);
        toast.error(`${file.name} 处理失败: ${err.message}`);
      }
    }

    setUploading(false);
    refetchDocs();
  }, [extractMutation, refetchDocs, projectId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const chunksPath = projectId ? `/project/${projectId}/chunks` : "/chunks";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            文档上传
          </h1>
          <p className="text-sm text-muted-foreground">上传 PDF 对话记录，自动解析分段并提取话题标签</p>
        </div>
      </div>

      {/* Upload Zone */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-8 md:p-12 text-center transition-all cursor-pointer ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-card/50"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <Upload className={`h-10 w-10 mx-auto mb-4 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
        <p className="text-foreground font-medium">
          {isDragging ? "释放文件以上传" : "拖拽 PDF 文件到此处，或点击选择"}
        </p>
        <p className="text-sm text-muted-foreground mt-1">支持多文件批量上传，单文件最大 100MB</p>
      </div>

      {/* Upload Progress */}
      {uploadProgress.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">处理进度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {uploadProgress.map((item, idx) => {
              const status = statusMap[item.status] || statusMap.uploading;
              return (
                <div key={idx} className="flex items-center justify-between py-2 px-3 rounded bg-secondary/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground truncate">{item.file}</span>
                  </div>
                  <Badge variant="secondary" className={`${status.color} shrink-0 ml-2`}>
                    <span className="flex items-center gap-1">
                      {status.icon}
                      {status.label}
                    </span>
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Document List */}
      {documents && documents.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              已上传文档 ({documents.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {documents.map((doc) => {
                const status = statusMap[doc.status] || statusMap.uploading;
                return (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between py-2.5 px-3 rounded hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{doc.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(doc.uploadTime).toLocaleString("zh-CN")} · {doc.chunkCount} 个分段
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <Badge variant="secondary" className={status.color}>
                        <span className="flex items-center gap-1">
                          {status.icon}
                          {status.label}
                        </span>
                      </Badge>
                      {doc.status === "done" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary hover:text-primary/80 h-7 px-2"
                          onClick={() => setLocation(chunksPath)}
                        >
                          <Tags className="h-3 w-3 mr-1" />
                          查看
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {(!documents || documents.length === 0) && uploadProgress.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>还没有上传任何文档</p>
          <p className="text-sm mt-1">上传 PDF 文件开始构建你的知识图谱</p>
        </div>
      )}
    </div>
  );
}
