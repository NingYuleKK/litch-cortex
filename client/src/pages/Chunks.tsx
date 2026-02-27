import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { FileText, Hash, Loader2, Layers, GitMerge, RefreshCw, Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ViewMode = "original" | "merged";

export default function ChunksPage({ projectId }: { projectId?: number }) {
  const [viewMode, setViewMode] = useState<ViewMode>("original");

  const { data: chunks, isLoading } = trpc.chunk.listAll.useQuery(
    projectId ? { projectId } : undefined
  );

  const { data: mergedChunks, isLoading: mergedLoading, refetch: refetchMerged } = trpc.mergedChunk.byProject.useQuery(
    projectId ? { projectId } : { projectId: 0 },
    { enabled: !!projectId }
  );

  // Get documents for the project to show merge buttons
  const { data: documents } = trpc.document.list.useQuery(
    projectId ? { projectId } : undefined,
    { enabled: !!projectId }
  );

  const mergeMutation = trpc.mergedChunk.merge.useMutation({
    onSuccess: (data) => {
      toast.success(`合并完成：${data.originalCount} 个原始分段 → ${data.mergedCount} 个合并分段`);
      refetchMerged();
    },
    onError: (err) => {
      toast.error(`合并失败：${err.message}`);
    },
  });

  const handleMerge = (documentId: number) => {
    mergeMutation.mutate({ documentId });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const showMerged = viewMode === "merged";
  const displayData = showMerged ? mergedChunks : chunks;
  const hasMergedData = mergedChunks && mergedChunks.length > 0;
  const doneDocuments = documents?.filter(d => d.status === "done") || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            分段预览
          </h1>
          <p className="text-sm text-muted-foreground">
            {showMerged
              ? `合并分段 · 共 ${mergedChunks?.length || 0} 个合并块（原始 ${chunks?.length || 0} 个）`
              : `原始分段 · 共 ${chunks?.length || 0} 个分段`
            }
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center bg-secondary/50 rounded-md p-0.5 shrink-0">
          <Button
            variant={viewMode === "original" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setViewMode("original")}
          >
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            原始分段
          </Button>
          <Button
            variant={viewMode === "merged" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setViewMode("merged")}
          >
            <GitMerge className="h-3.5 w-3.5 mr-1.5" />
            合并分段
            {hasMergedData && (
              <Badge variant="secondary" className="ml-1.5 h-4 text-[10px] px-1">
                {mergedChunks.length}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Merge Controls — always visible when there are done documents */}
      {doneDocuments.length > 0 && (
        <Card className="bg-card/50 border-border">
          <CardContent className="py-3 px-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-cyan-400" />
                <span>
                  {hasMergedData
                    ? `已有 ${mergedChunks?.length} 个合并分段。点击「重新合并」可重新触发 LLM 语义合并（每 5-8 个原始分段为一组）。`
                    : "尚未进行语义合并。点击「合并」按钮触发 LLM 语义合并，提升话题探索质量。"
                  }
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {doneDocuments.map(doc => (
                  <Button
                    key={doc.id}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
                    onClick={() => handleMerge(doc.id)}
                    disabled={mergeMutation.isPending}
                  >
                    {mergeMutation.isPending && mergeMutation.variables?.documentId === doc.id ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    {hasMergedData ? "重新合并" : "合并"}：
                    {doc.filename.length > 16 ? doc.filename.slice(0, 16) + "…" : doc.filename}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chunk List */}
      {showMerged && mergedLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : displayData && displayData.length > 0 ? (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {showMerged
                ? `MERGED_CHUNK_LOG [${displayData.length} entries]`
                : `CHUNK_LOG [${displayData.length} entries]`
              }
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-340px)]">
              <div className="divide-y divide-border">
                {displayData.map((item: any, idx: number) => (
                  <div
                    key={item.id}
                    className="px-4 py-3 hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-12 text-right">
                        <span className="text-xs font-mono text-muted-foreground">
                          #{String(idx + 1).padStart(3, "0")}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary h-5">
                            <FileText className="h-2.5 w-2.5 mr-1" />
                            {item.filename || `doc:${item.documentId}`}
                          </Badge>
                          <Badge variant="outline" className="text-xs font-mono border-border text-muted-foreground h-5">
                            <Hash className="h-2.5 w-2.5 mr-1" />
                            pos:{item.position}
                          </Badge>
                          {showMerged && item.sourceChunkIds && (
                            <Badge variant="outline" className="text-xs font-mono border-cyan-500/30 text-cyan-400 h-5">
                              <GitMerge className="h-2.5 w-2.5 mr-1" />
                              {(() => {
                                try {
                                  const ids = JSON.parse(item.sourceChunkIds);
                                  return `${ids.length} chunks`;
                                } catch {
                                  return "merged";
                                }
                              })()}
                            </Badge>
                          )}
                          {!showMerged && (
                            <span className="text-xs font-mono text-muted-foreground">
                              {item.tokenCount} chars
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-foreground/90 leading-relaxed line-clamp-4 font-mono whitespace-pre-line">
                          {item.content}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          {showMerged ? (
            <>
              <p>暂无合并分段数据</p>
              <p className="text-sm mt-1">请点击上方「合并」按钮触发 LLM 语义合并</p>
            </>
          ) : (
            <>
              <p>暂无分段数据</p>
              <p className="text-sm mt-1">请先上传 PDF 文档</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
