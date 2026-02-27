import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FileText, Loader2, Sparkles, Save, Tags, Download, FileDown, Merge, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import PromptTemplateSelector from "@/components/PromptTemplateSelector";
import { getSelectedTemplateId, getEffectivePrompt } from "@/lib/promptTemplates";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { exportAsMarkdown, exportAsPdf } from "@/lib/exportTopic";

export default function TopicDetailPage({ projectId, topicId: propTopicId }: { projectId?: number; topicId?: number }) {
  const [, setLocation] = useLocation();

  const topicId = propTopicId || 0;

  const { data, isLoading, refetch } = trpc.topic.get.useQuery(
    { id: topicId, projectId },
    { enabled: topicId > 0 }
  );

  const [summaryText, setSummaryText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => getSelectedTemplateId());
  const [chunkTab, setChunkTab] = useState<"original" | "merged">("original");

  // Merged chunks query
  const { data: mergedChunks, isLoading: mergedLoading, refetch: refetchMerged } = trpc.mergedChunk.byTopic.useQuery(
    { topicId },
    { enabled: topicId > 0 }
  );

  const { data: hasMerged } = trpc.mergedChunk.hasMerged.useQuery(
    { topicId },
    { enabled: topicId > 0 }
  );

  const mergeMutation = trpc.mergedChunk.mergeByTopic.useMutation({
    onSuccess: (result) => {
      toast.success(`合并完成：${result.originalCount} 个片段 → ${result.mergedCount} 个合并块`);
      refetchMerged();
      setChunkTab("merged");
    },
    onError: (err: any) => toast.error(`合并失败: ${err.message}`),
  });

  const saveMutation = trpc.summary.save.useMutation({
    onSuccess: () => {
      toast.success("总结已保存");
      setIsEditing(false);
      refetch();
    },
    onError: (err: any) => toast.error(`保存失败: ${err.message}`),
  });

  const generateMutation = trpc.summary.generate.useMutation({
    onSuccess: (result) => {
      setSummaryText(result.summaryText);
      toast.success("摘要生成完成");
      refetch();
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  useEffect(() => {
    if (data?.summary?.summaryText) {
      setSummaryText(data.summary.summaryText);
    }
  }, [data?.summary?.summaryText]);

  function handleExportMarkdown() {
    if (!data) return;
    exportAsMarkdown({
      title: data.topic.label,
      summary: summaryText || data.summary?.summaryText || "",
      chunks: data.chunks.map((c) => ({
        content: c.content,
        filename: c.filename,
      })),
    });
    toast.success("Markdown 已下载");
  }

  function handleExportPdf() {
    if (!data) return;
    exportAsPdf({
      title: data.topic.label,
      summary: summaryText || data.summary?.summaryText || "",
      chunks: data.chunks.map((c) => ({
        content: c.content,
        filename: c.filename,
      })),
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p>话题不存在</p>
        <Button variant="ghost" className="mt-4" onClick={() => {
          if (projectId) setLocation(`/project/${projectId}/topics`);
          else setLocation("/topics");
        }}>
          返回话题列表
        </Button>
      </div>
    );
  }

  const backPath = projectId ? `/project/${projectId}/topics` : "/topics";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setLocation(backPath)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-primary shrink-0" />
            <h1 className="text-xl font-semibold text-foreground truncate" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              {data.topic.label}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {data.chunks.length} 个关联片段 · 权重 {data.topic.weight}
          </p>
        </div>
        {/* Export Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs border-primary/30 text-primary hover:bg-primary/10"
            onClick={handleExportMarkdown}
          >
            <Download className="h-3 w-3 mr-1" />
            导出 MD
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs border-primary/30 text-primary hover:bg-primary/10"
            onClick={handleExportPdf}
          >
            <FileDown className="h-3 w-3 mr-1" />
            导出 PDF
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: "calc(100vh - 180px)" }}>
        {/* Left: Chunks with tabs */}
        <Card className="bg-card border-border flex flex-col overflow-hidden">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <Tabs value={chunkTab} onValueChange={(v) => setChunkTab(v as "original" | "merged")} className="w-full">
                <div className="flex items-center justify-between">
                  <TabsList className="h-7">
                    <TabsTrigger value="original" className="text-xs h-6 px-3">
                      原始片段 [{data.chunks.length}]
                    </TabsTrigger>
                    <TabsTrigger value="merged" className="text-xs h-6 px-3">
                      合并片段 [{mergedChunks?.length ?? 0}]
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-1.5">
                    {hasMerged ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        onClick={() => {
                          if (projectId) mergeMutation.mutate({ topicId, projectId });
                        }}
                        disabled={mergeMutation.isPending || !projectId}
                      >
                        {mergeMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1" />
                        )}
                        重新合并
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => {
                          if (projectId) mergeMutation.mutate({ topicId, projectId });
                        }}
                        disabled={mergeMutation.isPending || !projectId}
                      >
                        {mergeMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Merge className="h-3 w-3 mr-1" />
                        )}
                        合并相关分段
                      </Button>
                    )}
                  </div>
                </div>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            {chunkTab === "original" ? (
              <ScrollArea className="h-full">
                <div className="divide-y divide-border">
                  {data.chunks.map((chunk, idx) => (
                    <div key={chunk.id} className="px-4 py-3 hover:bg-secondary/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 w-8 text-right">
                          <span className="text-xs font-mono text-muted-foreground">
                            #{String(idx + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary h-5">
                              <FileText className="h-2.5 w-2.5 mr-1" />
                              {chunk.filename}
                            </Badge>
                            <span className="text-xs font-mono text-muted-foreground">
                              rel:{(chunk.relevanceScore ?? 1).toFixed(1)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                            {chunk.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <ScrollArea className="h-full">
                {mergedLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : mergedChunks && mergedChunks.length > 0 ? (
                  <div className="divide-y divide-border">
                    {mergedChunks.map((mc, idx) => (
                      <div key={mc.id} className="px-4 py-3 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="shrink-0 w-8 text-right">
                            <span className="text-xs font-mono text-amber-400">
                              M{String(idx + 1).padStart(2, "0")}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className="text-xs font-mono border-amber-500/30 text-amber-400 h-5">
                                <Merge className="h-2.5 w-2.5 mr-1" />
                                合并块
                              </Badge>
                              <span className="text-xs font-mono text-muted-foreground">
                                含 {JSON.parse(mc.sourceChunkIds || "[]").length} 个原始片段
                              </span>
                            </div>
                            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                              {mc.content}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Merge className="h-8 w-8 mb-3 opacity-30" />
                    <p className="text-sm">暂无合并分段</p>
                    <p className="text-xs mt-1">点击「合并相关分段」按钮进行 LLM 语义合并</p>
                  </div>
                )}
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Right: Summary */}
        <Card className="bg-card border-border flex flex-col overflow-hidden">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                话题总结
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() => {
                    const customPrompt = selectedTemplateId !== "academic" ? getEffectivePrompt(selectedTemplateId) : undefined;
                    generateMutation.mutate({ topicId, projectId, customPrompt });
                  }}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-3 w-3 mr-1" />
                  )}
                  LLM 生成摘要
                </Button>
                <PromptTemplateSelector
                  compact
                  onTemplateChange={(id) => setSelectedTemplateId(id)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
            {isEditing ? (
              <>
                <Textarea
                  value={summaryText}
                  onChange={(e) => setSummaryText(e.target.value)}
                  className="flex-1 resize-none bg-secondary/30 border-border text-foreground font-mono text-sm"
                  placeholder="在此编写话题总结..."
                />
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => saveMutation.mutate({ topicId, summaryText })}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3 w-3 mr-1" />
                    )}
                    保存
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setIsEditing(false);
                      if (data.summary?.summaryText) {
                        setSummaryText(data.summary.summaryText);
                      }
                    }}
                  >
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-auto">
                {summaryText ? (
                  <div className="space-y-3">
                    <div className="prose prose-sm prose-invert max-w-none text-foreground/90">
                      <Streamdown>{summaryText}</Streamdown>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setIsEditing(true)}
                    >
                      编辑总结
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <Sparkles className="h-8 w-8 mb-3 opacity-30" />
                    <p className="text-sm">暂无总结</p>
                    <p className="text-xs mt-1">点击「LLM 生成摘要」自动生成，或手动编写</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 h-7 text-xs"
                      onClick={() => setIsEditing(true)}
                    >
                      手动编写
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
