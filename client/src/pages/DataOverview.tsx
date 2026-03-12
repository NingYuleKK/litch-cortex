import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MessageSquare, FileText, Layers, Hash, Loader2,
  Zap, Tags, CheckCircle2, AlertCircle, Clock, RotateCcw,
  XCircle,
} from "lucide-react";
import { useState, useCallback } from "react";
import { toast } from "sonner";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    completed: { label: "已完成", className: "border-emerald-500/30 text-emerald-400" },
    running: { label: "运行中", className: "border-cyan-500/30 text-cyan-400" },
    pending: { label: "排队中", className: "border-amber-500/30 text-amber-400" },
    failed: { label: "失败", className: "border-red-500/30 text-red-400" },
    cancelled: { label: "已取消", className: "border-muted-foreground/30 text-muted-foreground" },
  };
  const c = config[status] || { label: status, className: "border-border text-muted-foreground" };
  return <Badge variant="outline" className={`text-[10px] ${c.className}`}>{c.label}</Badge>;
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function JobTypeLabel({ type }: { type: string }) {
  const labels: Record<string, string> = {
    embedding_generation: "向量生成",
    topic_extraction: "话题提取",
  };
  return <span>{labels[type] || type}</span>;
}

export default function DataOverview({ projectId }: { projectId: number }) {
  const { data, isLoading } = trpc.project.dataOverview.useQuery(
    { projectId },
    { refetchInterval: 5000 }
  );

  const [submitting, setSubmitting] = useState<string | null>(null);

  const submitEmbeddingJob = trpc.embedding.submitGenerationJob.useMutation();
  const submitTopicJob = trpc.extraction.extractProject.useMutation();
  const cancelJobMutation = trpc.job.cancel.useMutation();
  const retryJobMutation = trpc.job.retry.useMutation();

  const handleSubmitJob = useCallback(async (type: "embedding" | "topic") => {
    setSubmitting(type);
    try {
      if (type === "embedding") {
        const result = await submitEmbeddingJob.mutateAsync({ projectId });
        toast.success(result.deduplicated ? "已有向量生成任务在运行中" : "向量生成任务已提交");
      } else {
        const result = await submitTopicJob.mutateAsync({ projectId });
        toast.success(result.deduplicated ? "已有话题提取任务在运行中" : "话题提取任务已提交");
      }
    } catch (err: any) {
      toast.error(`提交失败: ${err.message}`);
    } finally {
      setSubmitting(null);
    }
  }, [projectId, submitEmbeddingJob, submitTopicJob]);

  const handleCancelJob = useCallback(async (jobId: number) => {
    try {
      await cancelJobMutation.mutateAsync({ jobId, projectId });
      toast.info("任务已取消");
    } catch (err: any) {
      toast.error(`取消失败: ${err.message}`);
    }
  }, [cancelJobMutation, projectId]);

  const handleRetryJob = useCallback(async (jobId: number) => {
    try {
      const result = await retryJobMutation.mutateAsync({ jobId, projectId });
      if (result.newJobId) toast.info("已重新提交任务");
    } catch (err: any) {
      toast.error(`重试失败: ${err.message}`);
    }
  }, [retryJobMutation, projectId]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const { counts, coverage, latestTasks, recentJobs } = data;

  // Check if there's an active embedding/topic job to disable buttons
  const hasActiveEmbeddingJob = recentJobs.some(
    (j) => j.type === "embedding_generation" && (j.status === "pending" || j.status === "running")
  );
  const hasActiveTopicJob = recentJobs.some(
    (j) => j.type === "topic_extraction" && (j.status === "pending" || j.status === "running")
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          数据概览
        </h1>
        <p className="text-sm text-muted-foreground">项目数据状态与任务管理</p>
      </div>

      {/* Data Counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: MessageSquare, label: "对话", value: counts.conversations, color: "text-cyan-400" },
          { icon: FileText, label: "文档", value: counts.documents, color: "text-blue-400" },
          { icon: Hash, label: "消息", value: counts.messages, color: "text-purple-400" },
          { icon: Layers, label: "分段", value: counts.chunks, color: "text-amber-400" },
        ].map((item) => (
          <Card key={item.label} className="bg-card/80 border-border/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <item.icon className={`h-4 w-4 ${item.color}`} />
                <span className="text-xs text-muted-foreground">{item.label}</span>
              </div>
              <div className="text-2xl font-semibold text-foreground font-mono">
                {item.value.toLocaleString()}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Coverage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Embedding Coverage */}
        <Card className="bg-card/80 border-border/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-cyan-400" />
                向量覆盖
              </CardTitle>
              <Button
                size="sm"
                className="gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white h-7 text-xs"
                disabled={hasActiveEmbeddingJob || coverage.embedding.percentage === 100 || submitting === "embedding"}
                onClick={() => handleSubmitJob("embedding")}
              >
                {submitting === "embedding" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : hasActiveEmbeddingJob ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : coverage.embedding.percentage === 100 ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                {hasActiveEmbeddingJob ? "运行中" : coverage.embedding.percentage === 100 ? "已完成" : "生成向量"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${coverage.embedding.percentage === 100 ? "bg-emerald-400" : "bg-cyan-400"}`}
                  style={{ width: `${coverage.embedding.percentage}%` }}
                />
              </div>
              <span className="text-sm font-mono text-muted-foreground w-16 text-right">
                {coverage.embedding.percentage}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {coverage.embedding.covered} / {coverage.embedding.total} 个分段已生成向量
            </p>
          </CardContent>
        </Card>

        {/* Topic Coverage */}
        <Card className="bg-card/80 border-border/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Tags className="h-4 w-4 text-purple-400" />
                话题覆盖
              </CardTitle>
              <Button
                size="sm"
                className="gap-1.5 bg-purple-600 hover:bg-purple-500 text-white h-7 text-xs"
                disabled={hasActiveTopicJob || coverage.topic.percentage === 100 || submitting === "topic"}
                onClick={() => handleSubmitJob("topic")}
              >
                {submitting === "topic" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : hasActiveTopicJob ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : coverage.topic.percentage === 100 ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Tags className="h-3 w-3" />
                )}
                {hasActiveTopicJob ? "运行中" : coverage.topic.percentage === 100 ? "已完成" : "提取话题"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${coverage.topic.percentage === 100 ? "bg-emerald-400" : "bg-purple-400"}`}
                  style={{ width: `${coverage.topic.percentage}%` }}
                />
              </div>
              <span className="text-sm font-mono text-muted-foreground w-16 text-right">
                {coverage.topic.percentage}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {coverage.topic.covered} / {coverage.topic.total} 个分段已提取话题 · 共 {coverage.topic.topicCount} 个话题
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Latest Tasks */}
      <Card className="bg-card/80 border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            最近任务
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {latestTasks.import && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">最近导入</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/70">{latestTasks.import.filename}</span>
                  <StatusBadge status={latestTasks.import.status} />
                  <span className="text-xs text-muted-foreground">{formatTime(latestTasks.import.completedAt)}</span>
                </div>
              </div>
            )}
            {latestTasks.embedding && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">向量生成</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/70">
                    {latestTasks.embedding.processedItems}/{latestTasks.embedding.totalItems}
                  </span>
                  <StatusBadge status={latestTasks.embedding.status} />
                  <span className="text-xs text-muted-foreground">{formatTime(latestTasks.embedding.completedAt)}</span>
                </div>
              </div>
            )}
            {latestTasks.topicExtraction && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">话题提取</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/70">
                    {latestTasks.topicExtraction.processedItems}/{latestTasks.topicExtraction.totalItems}
                  </span>
                  <StatusBadge status={latestTasks.topicExtraction.status} />
                  <span className="text-xs text-muted-foreground">{formatTime(latestTasks.topicExtraction.completedAt)}</span>
                </div>
              </div>
            )}
            {!latestTasks.import && !latestTasks.embedding && !latestTasks.topicExtraction && (
              <p className="text-xs text-muted-foreground">暂无任务记录</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Job Queue */}
      {recentJobs.length > 0 && (
        <Card className="bg-card/80 border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              任务队列
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {recentJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={job.status} />
                    <span className="text-sm">
                      <JobTypeLabel type={job.type} />
                    </span>
                    {(job.status === "running" || job.status === "pending") && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {job.status === "pending" ? "排队中..." : `${job.processedItems}/${job.totalItems} (${job.percentage}%)`}
                      </span>
                    )}
                    {job.status === "completed" && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {job.processedItems}/{job.totalItems}
                      </span>
                    )}
                    {job.status === "failed" && job.lastError && (
                      <span className="text-xs text-red-400 truncate max-w-[200px]" title={job.lastError}>
                        {job.lastError.substring(0, 50)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatTime(job.completedAt || job.createdAt)}</span>
                    {(job.status === "pending" || job.status === "running") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleCancelJob(job.id)}
                      >
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-red-400" />
                      </Button>
                    )}
                    {job.status === "failed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleRetryJob(job.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-muted-foreground hover:text-amber-400" />
                      </Button>
                    )}
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
