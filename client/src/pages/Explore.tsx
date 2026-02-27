import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Search, Sparkles, Save, Loader2, FileText, ChevronDown, ChevronUp, Download, FileDown } from "lucide-react";
import { exportAsMarkdown, exportAsPdf } from "@/lib/exportTopic";

interface ExploreResult {
  title: string;
  summary: string;
  chunks: Array<{
    id: number;
    documentId: number;
    content: string;
    filename: string;
  }>;
  chunkCount: number;
}

export default function Explore({ projectId }: { projectId: number }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());

  const searchMutation = trpc.explore.search.useMutation({
    onSuccess: (data) => {
      setResult(data as ExploreResult);
    },
    onError: (err) => {
      toast.error(err.message);
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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setResult(null);
    searchMutation.mutate({ projectId, query: query.trim() });
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

      {/* Search Form */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入关键词或问题，如「西门庆的经济活动」「潘金莲的命运」..."
            className="pl-10 bg-background border-border focus:border-cyan-500 focus:ring-cyan-500/20"
          />
        </div>
        <Button
          type="submit"
          disabled={searchMutation.isPending || !query.trim()}
          className="bg-cyan-600 hover:bg-cyan-500 text-white px-6"
        >
          {searchMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              探索中...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              探索
            </>
          )}
        </Button>
      </form>

      {/* Results */}
      {result && (
        <div className="space-y-6">
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

                return (
                  <div
                    key={chunk.id}
                    className="bg-card border border-border rounded-lg p-4 hover:border-cyan-500/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                        #{idx + 1}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">{chunk.filename}</span>
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
      {!result && !searchMutation.isPending && (
        <div className="text-center py-16 text-muted-foreground">
          <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">输入关键词开始探索话题</p>
          <p className="text-xs mt-1 opacity-70">系统会从文档中检索相关内容，并用 AI 整理成结构化总结</p>
        </div>
      )}
    </div>
  );
}
