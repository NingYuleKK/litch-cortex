import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, FileText, Loader2, Sparkles, Save, Tags, Download, FileDown,
  Merge, RefreshCw, Send, MessageSquare, Plus, Trash2, History, Edit3,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import PromptTemplateSelector from "@/components/PromptTemplateSelector";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { exportAsMarkdown, exportAsPdf } from "@/lib/exportTopic";

type ChatMessage = { role: string; content: string };

export default function TopicDetailPage({ projectId, topicId: propTopicId }: { projectId?: number; topicId?: number }) {
  const [, setLocation] = useLocation();
  const topicId = propTopicId || 0;

  // ─── Data queries ───────────────────────────────────────────────
  const { data, isLoading, refetch } = trpc.topic.get.useQuery(
    { id: topicId, projectId },
    { enabled: topicId > 0 }
  );

  const { data: mergedChunks, isLoading: mergedLoading, refetch: refetchMerged } = trpc.mergedChunk.byTopic.useQuery(
    { topicId },
    { enabled: topicId > 0 }
  );

  const { data: hasMerged } = trpc.mergedChunk.hasMerged.useQuery(
    { topicId },
    { enabled: topicId > 0 }
  );

  const { data: conversations, refetch: refetchConversations } = trpc.summary.listConversations.useQuery(
    { topicId, projectId },
    { enabled: topicId > 0 }
  );

  // ─── State ──────────────────────────────────────────────────────
  const [summaryText, setSummaryText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<string | undefined>(undefined);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | undefined>(undefined);
  const [chunkTab, setChunkTab] = useState<"original" | "merged">("original");

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [rightTab, setRightTab] = useState<"chat" | "summary">("chat");
  const [showHistory, setShowHistory] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // ─── Mutations ──────────────────────────────────────────────────
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

  const startChatMutation = trpc.summary.startChat.useMutation({
    onSuccess: (result) => {
      setChatMessages(result.messages as ChatMessage[]);
      setActiveConversationId(result.conversationId);
      setSummaryText(result.assistantMessage);
      toast.success("对话已开始");
      refetchConversations();
      refetch();
    },
    onError: (err: any) => toast.error(`对话启动失败: ${err.message}`),
  });

  const continueChatMutation = trpc.summary.continueChat.useMutation({
    onSuccess: (result) => {
      setChatMessages(result.messages as ChatMessage[]);
      setSummaryText(result.assistantMessage);
      refetch();
    },
    onError: (err: any) => toast.error(`发送失败: ${err.message}`),
  });

  const deleteConvMutation = trpc.summary.deleteConversation.useMutation({
    onSuccess: () => {
      toast.success("对话已删除");
      if (activeConversationId) {
        setActiveConversationId(null);
        setChatMessages([]);
      }
      refetchConversations();
    },
    onError: (err: any) => toast.error(`删除失败: ${err.message}`),
  });

  // ─── Load conversation ──────────────────────────────────────────
  const loadConversationQuery = trpc.summary.getConversation.useQuery(
    { conversationId: activeConversationId! },
    { enabled: !!activeConversationId && chatMessages.length === 0 }
  );

  useEffect(() => {
    if (loadConversationQuery.data && chatMessages.length === 0) {
      setChatMessages(loadConversationQuery.data.messages as ChatMessage[]);
    }
  }, [loadConversationQuery.data]);

  // ─── Init summary text from DB ─────────────────────────────────
  useEffect(() => {
    if (data?.summary?.summaryText && !summaryText) {
      setSummaryText(data.summary.summaryText);
    }
  }, [data?.summary?.summaryText]);

  // ─── Auto-scroll chat ──────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, startChatMutation.isPending, continueChatMutation.isPending]);

  // ─── Handlers ──────────────────────────────────────────────────
  function handleStartChat() {
    startChatMutation.mutate({
      topicId,
      projectId,
      customPrompt: selectedPrompt,
      promptTemplateId: selectedTemplateId,
    });
  }

  function handleSendMessage() {
    const msg = chatInput.trim();
    if (!msg || !activeConversationId) return;

    // Optimistic: show user message immediately
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setChatInput("");

    continueChatMutation.mutate({
      conversationId: activeConversationId,
      userMessage: msg,
    });

    chatInputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  function handleLoadConversation(convId: number) {
    setActiveConversationId(convId);
    setChatMessages([]); // Will be loaded by query
    setShowHistory(false);
    setRightTab("chat");
  }

  function handleNewChat() {
    setActiveConversationId(null);
    setChatMessages([]);
    setShowHistory(false);
  }

  function handleExportMarkdown() {
    if (!data) return;
    exportAsMarkdown({
      title: data.topic.label,
      summary: summaryText || data.summary?.summaryText || "",
      chunks: data.chunks.map((c) => ({ content: c.content, filename: c.filename })),
    });
    toast.success("Markdown 已下载");
  }

  function handleExportPdf() {
    if (!data) return;
    exportAsPdf({
      title: data.topic.label,
      summary: summaryText || data.summary?.summaryText || "",
      chunks: data.chunks.map((c) => ({ content: c.content, filename: c.filename })),
    });
  }

  // ─── Loading / Error states ────────────────────────────────────
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
  const isLLMBusy = startChatMutation.isPending || continueChatMutation.isPending;
  const hasActiveChat = activeConversationId !== null && chatMessages.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setLocation(backPath)}>
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
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="h-8 text-xs border-primary/30 text-primary hover:bg-primary/10" onClick={handleExportMarkdown}>
            <Download className="h-3 w-3 mr-1" />
            导出 MD
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs border-primary/30 text-primary hover:bg-primary/10" onClick={handleExportPdf}>
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
                        variant="outline" size="sm"
                        className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        onClick={() => { if (projectId) mergeMutation.mutate({ topicId, projectId }); }}
                        disabled={mergeMutation.isPending || !projectId}
                      >
                        {mergeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                        重新合并
                      </Button>
                    ) : (
                      <Button
                        variant="outline" size="sm"
                        className="h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => { if (projectId) mergeMutation.mutate({ topicId, projectId }); }}
                        disabled={mergeMutation.isPending || !projectId}
                      >
                        {mergeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Merge className="h-3 w-3 mr-1" />}
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
                          <span className="text-xs font-mono text-muted-foreground">#{String(idx + 1).padStart(2, "0")}</span>
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
                          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
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
                            <span className="text-xs font-mono text-amber-400">M{String(idx + 1).padStart(2, "0")}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline" className="text-xs font-mono border-amber-500/30 text-amber-400 h-5">合并块</Badge>
                              <span className="text-xs font-mono text-muted-foreground">
                                含 {JSON.parse(mc.sourceChunkIds || "[]").length} 个原始片段
                              </span>
                            </div>
                            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{mc.content}</p>
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

        {/* Right: Chat + Summary tabs */}
        <Card className="bg-card border-border flex flex-col overflow-hidden">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as "chat" | "summary")} className="w-full">
                <div className="flex items-center justify-between">
                  <TabsList className="h-7">
                    <TabsTrigger value="chat" className="text-xs h-6 px-3">
                      <MessageSquare className="h-3 w-3 mr-1" />
                      对话
                    </TabsTrigger>
                    <TabsTrigger value="summary" className="text-xs h-6 px-3">
                      <Edit3 className="h-3 w-3 mr-1" />
                      总结
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex items-center gap-1.5">
                    {rightTab === "chat" && (
                      <>
                        {conversations && conversations.length > 0 && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setShowHistory(!showHistory)}
                          >
                            <History className="h-3 w-3 mr-1" />
                            历史 ({conversations.length})
                          </Button>
                        )}
                        <PromptTemplateSelector
                          compact
                          onTemplateChange={(id, prompt) => {
                            setSelectedTemplateId(parseInt(id));
                            setSelectedPrompt(prompt);
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              </Tabs>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col gap-0 overflow-hidden p-0">
            {rightTab === "chat" ? (
              <>
                {/* History panel (overlay) */}
                {showHistory && conversations && conversations.length > 0 && (
                  <div className="border-b border-border bg-secondary/20 px-4 py-2 max-h-40 overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">历史对话</span>
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleNewChat}>
                        <Plus className="h-3 w-3 mr-1" />
                        新对话
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {conversations.map((conv) => (
                        <div
                          key={conv.id}
                          className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                            activeConversationId === conv.id
                              ? "bg-primary/15 text-primary border border-primary/30"
                              : "hover:bg-secondary/50 text-foreground/70"
                          }`}
                          onClick={() => handleLoadConversation(conv.id)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <MessageSquare className="h-3 w-3 shrink-0 opacity-50" />
                            <span className="truncate">{conv.title || `对话 #${conv.id}`}</span>
                            <span className="text-muted-foreground shrink-0">{conv.messageCount} 条</span>
                          </div>
                          <Button
                            variant="ghost" size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteConvMutation.mutate({ conversationId: conv.id });
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chat messages area */}
                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {!hasActiveChat && !isLLMBusy ? (
                    /* Empty state: start conversation */
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <div className="relative mb-4">
                        <MessageSquare className="h-12 w-12 opacity-20" />
                        <Sparkles className="h-5 w-5 text-primary absolute -top-1 -right-1 opacity-60" />
                      </div>
                      <p className="text-sm font-medium text-foreground/70 mb-1">话题对话</p>
                      <p className="text-xs text-center max-w-[240px] mb-4">
                        基于话题相关片段，与 LLM 进行多轮对话。支持确认、修改、追问等交互。
                      </p>
                      <Button
                        size="sm"
                        className="h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
                        onClick={handleStartChat}
                        disabled={isLLMBusy}
                      >
                        {isLLMBusy ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        开始对话
                      </Button>
                      {conversations && conversations.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-3">
                          或从上方 <button className="text-primary hover:underline" onClick={() => setShowHistory(true)}>历史对话</button> 中继续
                        </p>
                      )}
                    </div>
                  ) : (
                    /* Chat messages */
                    <div className="space-y-4">
                      {chatMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          {msg.role === "assistant" && (
                            <div className="size-7 shrink-0 mt-1 rounded-full bg-primary/15 flex items-center justify-center">
                              <Sparkles className="size-3.5 text-primary" />
                            </div>
                          )}
                          <div
                            className={`max-w-[85%] rounded-lg px-3 py-2 ${
                              msg.role === "user"
                                ? "bg-primary/20 text-foreground border border-primary/20"
                                : "bg-secondary/40 text-foreground border border-border/50"
                            }`}
                          >
                            {msg.role === "assistant" ? (
                              <div className="prose prose-sm prose-invert max-w-none text-foreground/90">
                                <Streamdown>{msg.content}</Streamdown>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                            )}
                          </div>
                          {msg.role === "user" && (
                            <div className="size-7 shrink-0 mt-1 rounded-full bg-secondary flex items-center justify-center">
                              <span className="text-xs font-mono text-secondary-foreground">U</span>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Loading indicator */}
                      {isLLMBusy && (
                        <div className="flex items-start gap-3">
                          <div className="size-7 shrink-0 mt-1 rounded-full bg-primary/15 flex items-center justify-center">
                            <Sparkles className="size-3.5 text-primary" />
                          </div>
                          <div className="rounded-lg bg-secondary/40 border border-border/50 px-3 py-2">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span className="text-xs">思考中...</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>

                {/* Chat input */}
                {hasActiveChat && (
                  <div className="border-t border-border bg-background/30 px-3 py-2">
                    <div className="flex gap-2 items-end">
                      <Textarea
                        ref={chatInputRef}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                        className="flex-1 max-h-24 resize-none min-h-[36px] bg-secondary/20 border-border text-sm"
                        rows={1}
                      />
                      <Button
                        size="icon"
                        className="shrink-0 h-[36px] w-[36px] bg-primary hover:bg-primary/90"
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || isLLMBusy}
                      >
                        {isLLMBusy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] text-muted-foreground">快捷回复:</span>
                      {["确认，请继续", "请调整标题", "请精简内容", "请补充细节"].map((q) => (
                        <button
                          key={q}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors"
                          onClick={() => {
                            setChatInput(q);
                            chatInputRef.current?.focus();
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Summary tab (legacy) */
              <div className="flex-1 flex flex-col gap-3 overflow-hidden px-4 py-3">
                <div className="flex items-center justify-between shrink-0">
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">话题总结</span>
                  <div className="flex items-center gap-2">
                    <PromptTemplateSelector
                      compact
                      onTemplateChange={(_id, prompt) => setSelectedPrompt(prompt)}
                    />
                  </div>
                </div>
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
                        size="sm" className="h-8"
                        onClick={() => saveMutation.mutate({ topicId, summaryText })}
                        disabled={saveMutation.isPending}
                      >
                        {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                        保存
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => {
                        setIsEditing(false);
                        if (data.summary?.summaryText) setSummaryText(data.summary.summaryText);
                      }}>
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
                          variant="ghost" size="sm"
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
                        <p className="text-xs mt-1">切换到「对话」标签使用 LLM 生成，或手动编写</p>
                        <Button variant="outline" size="sm" className="mt-4 h-7 text-xs" onClick={() => setIsEditing(true)}>
                          手动编写
                        </Button>
                      </div>
                    )}
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
