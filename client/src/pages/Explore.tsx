import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Search, Sparkles, Save, Loader2, FileText, ChevronDown, ChevronUp, Download, FileDown, Zap, Type } from "lucide-react";
import PromptTemplateSelector from "@/components/PromptTemplateSelector";
import { exportAsMarkdown, exportAsPdf } from "@/lib/exportTopic";

type SearchMode = "semantic" | "keyword";

interface ExploreChunk {
  id: number;
  documentId: number;
  content: string;
  filename: string;
  similarity?: number;
}

interface ExploreResult {
  title: string;
  summary: string;
  chunks: ExploreChunk[];
  chunkCount: number;
  searchMode?: string;
  similarities?: number[];
}

export default function Explore({ projectId }: { projectId: number }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [selectedPrompt, setSelectedPrompt] = useState<string | undefined>(undefined);
  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");

  // Embedding status query
  const embeddingStatus = trpc.embedding.status.useQuery(
    { projectId },
    { refetchInterval: false }
  );

  const hasEmbeddings = (embeddingStatus.data?.embeddedChunks ?? 0) > 0;

  // Keyword search mutation (original)
  const keywordSearchMutation = trpc.explore.search.useMutation({
    onSuccess: (data) => {
      setResult({ ...data as ExploreResult, searchMode: "keyword" });
    },
    onError: (err) => {
      const msg = err.message || "未知错误";
      if (msg.includes("LLM") || msg.includes("timeout") || msg.includes("API")) {
        toast.error(msg, { duration: 6000 });
      } else {
        toast.error(`探索失败，请稍后重试。${msg.length > 100 ? "" : " (" + msg + ")"}`, { duration: 5000 });
      }
    },
  });

  // Semantic search mutation
  const semanticSearchMutation = trpc.embedding.semanticSearch.useMutation({
    onSuccess: (data) => {
      setResult(data as ExploreResult);
    },
    onError: (err) => {
      const msg = err.message || "未知错误";
      if (msg.includes("Embedding") || msg.includes("配置")) {
        toast.error(msg, { duration: 6000 });
      } else {
        toast.error(`语义搜索失败: ${msg.length > 100 ? msg.substring(0, 100) + "..." : msg}`, { duration: 5000 });
      }
    },
  });

  const saveMutation = trpc.explore.saveAsTopic.useMutation({
    onSuccess: (data) => {
      toast.success(`已保存为话题 #${data.topicId}`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const isPending = keywordSearchMutation.isPending || semanticSearchMutation.isPending;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setResult(null);

    if (searchMode === "semantic") {
      semanticSearchMutation.mutate({
        projectId,
        query: query.trim(),
        customPrompt: selectedPrompt,
      });
    } else {
      keywordSearchMutation.mutate({
        projectId,
        query: query.trim(),
        customPrompt: selectedPrompt,
      });
    }
  }

  function handleSave() {
    if (!result) return;
    saveMutation.mutate({
      title: result.title,
      summary: result.summary,
      chunkIds: result.chunks.map((c) => c.id),
    });
  }

  function handleExportMarkdown() {
    if (!result) return;
    exportAsMarkdown({
      title: result.title,
      summary: result.summary,
      chunks: result.chunks.map((c) => ({
        content: c.content,
        filename: c.filename,
      })),
    });
    toast.success("Markdown 已下载");
  }

  function handleExportPdf() {
    if (!result) return;
    exportAsPdf({
      title: result.title,
      summary: result.summary,
      chunks: result.chunks.map((c) => ({
        content: c.content,
        filename: c.filename,
      })),
    });
  }

  function toggleChunk(id: number) {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Effective search mode — auto-fallback to keyword if no embeddings
  const effectiveMode = useMemo(() => {
    if (searchMode === "semantic" && !hasEmbeddings) return "keyword";
    return searchMode;
  }, [searchMode, hasEmbeddings]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Sparkles className="w-5 h-5 text-cyan-400" />
        <h1 className="text-xl font-bold text-foreground">话题探索</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        输入关键词或问题，系统会从当前项目的文档中检索相关内容，并用 LLM 整理出结构化的话题总结。
      </p>

      {/* Search Mode Toggle + Embedding Status */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center bg-secondary/50 rounded-md p-0.5">
          <Button
            variant={searchMode === "semantic" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setSearchMode("semantic")}
          >
            <Zap className="h-3.5 w-3.5" />
            语义搜索
          </Button>
          <Button
            variant={searchMode === "keyword" ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setSearchMode("keyword")}
          >
            <Type className="h-3.5 w-3.5" />
            关键词搜索
          </Button>
        </div>

        {/* Embedding status indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {embeddingStatus.data && (
            <>
              <div className={`h-2 w-2 rounded-full ${embeddingStatus.data.percentage === 100 ? "bg-emerald-400" : embeddingStatus.data.percentage > 0 ? "bg-amber-400" : "bg-red-400"}`} />
              <span>
                向量覆盖: {embeddingStatus.data.embeddedChunks}/{embeddingStatus.data.totalChunks}
                ({embeddingStatus.data.percentage}%)
              </span>
            </>
          )}
          {searchMode === "semantic" && !hasEmbeddings && (
            <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[10px]">
              无向量数据，将回退到关键词搜索
            </Badge>
          )}
        </div>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex items-center gap-2">
          <PromptTemplateSelector
            compact
            onTemplateChange={(_id, prompt) => setSelectedPrompt(prompt)}
          />
          <span className="text-xs text-muted-foreground">选择 Prompt 模板影响 LLM 输出风格</span>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                effectiveMode === "semantic"
                  ? "输入自然语言问题，如「西门庆的经济活动有哪些特点」..."
                  : "输入关键词，如「西门庆」「经济活动」..."
              }
              className="pl-10 bg-background border-border focus:border-cyan-500 focus:ring-cyan-500/20"
            />
          </div>
          <Button
            type="submit"
            disabled={isPending || !query.trim()}
            className="bg-cyan-600 hover:bg-cyan-500 text-white px-6"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {effectiveMode === "semantic" ? "语义搜索中..." : "搜索中..."}
              </>
            ) : (
              <>
                {effectiveMode === "semantic" ? <Zap className="w-4 h-4 mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                {effectiveMode === "semantic" ? "语义探索" : "关键词探索"}
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Search Mode Badge */}
          {result.searchMode && (
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={`text-xs ${
                  result.searchMode === "semantic"
                    ? "border-cyan-500/30 text-cyan-400"
                    : result.searchMode === "keyword"
                    ? "border-amber-500/30 text-amber-400"
                    : "border-border text-muted-foreground"
                }`}
              >
                {result.searchMode === "semantic" ? "🧠 语义搜索" : "🔤 关键词搜索"}
              </Badge>
            </div>
          )}

          {/* Summary Card */}
          <div className="bg-card border border-cyan-500/20 rounded-xl p-6 shadow-lg shadow-cyan-500/5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-cyan-400">{result.title}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  匹配到 {result.chunkCount} 个相关片段，展示 {result.chunks.length} 个
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={handleExportMarkdown}
                  size="sm"
                  variant="outline"
                  className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  导出 MD
                </Button>
                <Button
                  onClick={handleExportPdf}
                  size="sm"
                  variant="outline"
                  className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                >
                  <FileDown className="w-3.5 h-3.5 mr-1" />
                  导出 PDF
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending || result.chunks.length === 0}
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-1" />
                  )}
                  保存为 Topic
                </Button>
              </div>
            </div>
            <div className="prose prose-sm prose-invert max-w-none text-foreground/90">
              <Streamdown>{result.summary}</Streamdown>
            </div>
          </div>

          {/* Related Chunks */}
          {result.chunks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <FileText className="w-4 h-4" />
                关联原文片段 ({result.chunks.length})
              </h3>
              {result.chunks.map((chunk, idx) => {
                const isExpanded = expandedChunks.has(chunk.id);
                const preview = chunk.content.slice(0, 200);
                const needsExpand = chunk.content.length > 200;
                const similarity = chunk.similarity;

                return (
                  <div
                    key={chunk.id}
                    className="bg-card border border-border rounded-lg p-4 hover:border-cyan-500/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                        #{idx + 1}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">{chunk.filename}</span>
                      {similarity !== undefined && similarity > 0 && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono ${
                            similarity >= 0.8
                              ? "border-emerald-500/40 text-emerald-400"
                              : similarity >= 0.6
                              ? "border-cyan-500/40 text-cyan-400"
                              : similarity >= 0.4
                              ? "border-amber-500/40 text-amber-400"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          相似度 {(similarity * 100).toFixed(1)}%
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                      {isExpanded ? chunk.content : preview}
                      {needsExpand && !isExpanded && "..."}
                    </p>
                    {needsExpand && (
                      <button
                        onClick={() => toggleChunk(chunk.id)}
                        className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3 h-3" /> 收起
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3 h-3" /> 展开全文
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !isPending && (
        <div className="text-center py-16 text-muted-foreground">
          <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">输入关键词开始探索话题</p>
          <p className="text-xs mt-1 opacity-70">
            {hasEmbeddings
              ? "语义搜索已就绪，支持自然语言查询"
              : "请先在分段预览页生成向量以启用语义搜索"}
          </p>
        </div>
      )}
    </div>
  );
}
