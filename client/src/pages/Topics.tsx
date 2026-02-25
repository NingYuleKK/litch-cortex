import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tags, Hash, Loader2, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";

export default function TopicsPage({ projectId }: { projectId?: number }) {
  const [, setLocation] = useLocation();
  const { data: topics, isLoading } = trpc.topic.list.useQuery(
    projectId ? { projectId } : undefined
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const handleTopicClick = (topicId: number) => {
    if (projectId) {
      setLocation(`/project/${projectId}/topics/${topicId}`);
    } else {
      setLocation(`/topics/${topicId}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          话题列表
        </h1>
        <p className="text-sm text-muted-foreground">
          LLM 自动提取的话题标签 · 共 {topics?.length || 0} 个话题
        </p>
      </div>

      {/* Topic Grid */}
      {topics && topics.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((topic) => (
            <Card
              key={topic.id}
              className="bg-card border-border hover:border-primary/40 transition-all cursor-pointer group"
              onClick={() => handleTopicClick(topic.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Tags className="h-4 w-4 text-primary shrink-0" />
                      <h3 className="text-sm font-medium text-foreground truncate">
                        {topic.label}
                      </h3>
                    </div>
                    {topic.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                        {topic.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="text-xs font-mono">
                        <Hash className="h-2.5 w-2.5 mr-1" />
                        {topic.chunkCount} 个片段
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        w:{topic.weight}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <Tags className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>暂无话题数据</p>
          <p className="text-sm mt-1">上传 PDF 文档后将自动提取话题标签</p>
        </div>
      )}
    </div>
  );
}
