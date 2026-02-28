import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { FileText, Hash, Loader2, Layers, GitMerge, Tags, Zap, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ViewMode = "original" | "merged";

export default function ChunksPage({ projectId }: { projectId?: number }) {
  const [viewMode, setViewMode] = useState<ViewMode>("original");

  const { data: chunks, isLoading } = trpc.chunk.listAll.useQuery(
    projectId ? { projectId } : undefined
  );

  const { data: mergedChunks, isLoading: mergedLoading } = trpc.mergedChunk.byProject.useQuery(
    projectId ? { projectId } : { projectId: 0 },
    { enabled: !!projectId }
  );

  // Embedding status
  const embeddingStatus = trpc.embedding.status.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  // Generate embeddings mutation
  const generateEmbeddings = trpc.embedding.generateForProject.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      embeddingStatus.refetch();
    },
    onError: (err) => {
      toast.error(`向量生成失败: ${err.message}`, { duration: 6000 });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const showMerged = viewMode === "merged";
  const hasMergedData = mergedChunks && mergedChunks.length > 0;

  // Group merged chunks by topic
  const mergedByTopic = hasMergedData
    ? mergedChunks.reduce((acc: Record<string, { topicLabel: string; topicId: number; chunks: typeof mergedChunks }>, mc) => {
        const key = String(mc.topicId);
        if (!acc[key]) {
          acc[key] = { topicLabel: (mc as any).topicLabel || `话题 #${mc.topicId}`, topicId: mc.topicId, chunks: [] };
        }
        acc[key].chunks.push(mc);
        return acc;
      }, {})
    : {};

  const topicGroups = Object.values(mergedByTopic);

  const embStatus = embeddingStatus.data;
  const embPercentage = embStatus?.percentage ?? 0;

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
              ? `合并分段 · ${topicGroups.length} 个话题 · 共 ${mergedChunks?.length || 0} 个合并块`
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

      {/* Embedding Status Card */}
      {projectId && embStatus && (
        <Card className="bg-card/80 border-border/40">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                  embPercentage === 100
                    ? "bg-emerald-500/10"
                    : embPercentage > 0
                    ? "bg-amber-500/10"
                    : "bg-muted/50"
                }`}>
                  {embPercentage === 100 ? (
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />
                  ) : embPercentage > 0 ? (
                    <Zap className="h-4.5 w-4.5 text-amber-400" />
                  ) : (
                    <AlertCircle className="h-4.5 w-4.5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">Embedding 向量</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        embPercentage === 100
                          ? "border-emerald-500/30 text-emerald-400"
                          : embPercentage > 0
                          ? "border-amber-500/30 text-amber-400"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {embStatus.embeddedChunks}/{embStatus.totalChunks} ({embPercentage}%)
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {embPercentage === 100
                      ? "所有分段已生成向量，语义搜索已就绪"
                      : embPercentage > 0
                      ? "部分分段已生成向量，可继续补充生成"
                      : "尚未生成向量，点击按钮开始生成以启用语义搜索"}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex items-center gap-3 shrink-0">
                {embStatus.totalChunks > 0 && (
                  <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        embPercentage === 100 ? "bg-emerald-400" : "bg-cyan-400"
                      }`}
                      style={{ width: `${embPercentage}%` }}
                    />
                  </div>
                )}
                <Button
                  size="sm"
                  className="gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white"
                  disabled={generateEmbeddings.isPending || embPercentage === 100}
                  onClick={() => generateEmbeddings.mutate({ projectId })}
                >
                  {generateEmbeddings.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      生成中...
                    </>
                  ) : embPercentage === 100 ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      已完成
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5" />
                      生成向量
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {showMerged ? (
        mergedLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : topicGroups.length > 0 ? (
          <div className="space-y-4">
            {topicGroups.map((group) => (
              <Card key={group.topicId} className="bg-card border-border">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Tags className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm font-semibold text-foreground">
                      {group.topicLabel}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs font-mono border-amber-500/30 text-amber-400 h-5">
                      {group.chunks.length} 个合并块
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {group.chunks.map((mc, idx) => (
                      <div key={mc.id} className="px-4 py-3 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="shrink-0 w-10 text-right">
                            <span className="text-xs font-mono text-amber-400">
                              M{String(idx + 1).padStart(2, "0")}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <Badge variant="outline" className="text-xs font-mono border-border text-muted-foreground h-5">
                                <Hash className="h-2.5 w-2.5 mr-1" />
                                pos:{mc.position}
                              </Badge>
                              {mc.sourceChunkIds && (
                                <Badge variant="outline" className="text-xs font-mono border-cyan-500/30 text-cyan-400 h-5">
                                  <GitMerge className="h-2.5 w-2.5 mr-1" />
                                  {(() => {
                                    try {
                                      const ids = JSON.parse(mc.sourceChunkIds);
                                      return `${ids.length} 个原始片段`;
                                    } catch {
                                      return "merged";
                                    }
                                  })()}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
                              {mc.content}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <GitMerge className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>暂无合并分段数据</p>
            <p className="text-sm mt-1">请在话题详情页点击「合并相关分段」按钮进行按话题的 LLM 语义合并</p>
          </div>
        )
      ) : (
        chunks && chunks.length > 0 ? (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                CHUNK_LOG [{chunks.length} entries]
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-360px)]">
                <div className="divide-y divide-border">
                  {chunks.map((item: any, idx: number) => (
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
                            <span className="text-xs font-mono text-muted-foreground">
                              {item.tokenCount} chars
                            </span>
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
            <p>暂无分段数据</p>
            <p className="text-sm mt-1">请先上传 PDF 文档</p>
          </div>
        )
      )}
    </div>
  );
}
