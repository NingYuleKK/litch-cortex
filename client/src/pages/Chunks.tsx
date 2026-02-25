import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Hash, Loader2 } from "lucide-react";

export default function ChunksPage() {
  const { data: chunks, isLoading } = trpc.chunk.listAll.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          分段预览
        </h1>
        <p className="text-sm text-muted-foreground">
          所有已解析的文本块 · 共 {chunks?.length || 0} 个分段
        </p>
      </div>

      {/* Chunk List - Log Panel Style */}
      {chunks && chunks.length > 0 ? (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              CHUNK_LOG [{chunks.length} entries]
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-220px)]">
              <div className="divide-y divide-border">
                {chunks.map((chunk, idx) => (
                  <div
                    key={chunk.id}
                    className="px-4 py-3 hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Line number */}
                      <div className="shrink-0 w-12 text-right">
                        <span className="text-xs font-mono text-muted-foreground">
                          #{String(idx + 1).padStart(3, "0")}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {/* Meta line */}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary h-5">
                            <FileText className="h-2.5 w-2.5 mr-1" />
                            {chunk.filename}
                          </Badge>
                          <Badge variant="outline" className="text-xs font-mono border-border text-muted-foreground h-5">
                            <Hash className="h-2.5 w-2.5 mr-1" />
                            pos:{chunk.position}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground">
                            {chunk.tokenCount} chars
                          </span>
                        </div>

                        {/* Text content */}
                        <p className="text-sm text-foreground/90 leading-relaxed line-clamp-3 font-mono">
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
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>暂无分段数据</p>
          <p className="text-sm mt-1">请先上传 PDF 文档</p>
        </div>
      )}
    </div>
  );
}
