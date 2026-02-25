import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, FileText, Hash, Loader2, Sparkles, Save, Tags } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

export default function TopicDetailPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const topicId = parseInt(params.id || "0");

  const { data, isLoading, refetch } = trpc.topic.get.useQuery(
    { id: topicId },
    { enabled: topicId > 0 }
  );

  const [summaryText, setSummaryText] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const saveMutation = trpc.summary.save.useMutation({
    onSuccess: () => {
      toast.success("总结已保存");
      setIsEditing(false);
      refetch();
    },
    onError: (err) => toast.error(`保存失败: ${err.message}`),
  });

  const generateMutation = trpc.summary.generate.useMutation({
    onSuccess: (result) => {
      setSummaryText(result.summaryText);
      toast.success("摘要生成完成");
      refetch();
    },
    onError: (err) => toast.error(`生成失败: ${err.message}`),
  });

  // Sync summary text from server data
  useEffect(() => {
    if (data?.summary?.summaryText) {
      setSummaryText(data.summary.summaryText);
    }
  }, [data?.summary?.summaryText]);

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
        <Button variant="ghost" className="mt-4" onClick={() => setLocation("/topics")}>
          返回话题列表
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setLocation("/topics")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
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
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ height: "calc(100vh - 180px)" }}>
        {/* Left: Chunks */}
        <Card className="bg-card border-border flex flex-col overflow-hidden">
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              关联文本片段 [{data.chunks.length}]
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
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
                  onClick={() => generateMutation.mutate({ topicId })}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-3 w-3 mr-1" />
                  )}
                  LLM 生成摘要
                </Button>
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
