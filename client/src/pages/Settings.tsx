import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Eye, EyeOff, Save, Zap, ChevronDown, ChevronRight, Loader2, FileText, ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";

const TASK_TYPES = [
  { key: "topic_extract", label: "话题提取", desc: "从文本中提取话题标签" },
  { key: "summarize", label: "摘要生成", desc: "生成话题总结" },
  { key: "explore", label: "话题探索", desc: "搜索并整理话题" },
  { key: "chunk_merge", label: "分段合并", desc: "语义合并文本片段" },
];

const PROVIDER_OPTIONS = [
  { value: "builtin", label: "内置 (Manus Forge)", desc: "使用平台内置 LLM 服务" },
  { value: "openai", label: "OpenAI", desc: "使用 OpenAI API (GPT-4 等)" },
  { value: "openrouter", label: "OpenRouter", desc: "统一网关，支持 Claude/GPT/Gemini 等" },
  { value: "custom", label: "自定义", desc: "自定义 OpenAI 兼容 API" },
];

export default function Settings() {
  const [provider, setProvider] = useState("builtin");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [taskModels, setTaskModels] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [, setLocation] = useLocation();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; reply?: string; error?: string } | null>(null);

  const configQuery = trpc.llmSettings.getConfig.useQuery();
  const saveMutation = trpc.llmSettings.saveConfig.useMutation();
  const testMutation = trpc.llmSettings.testConnection.useMutation();

  // Load config from server
  useEffect(() => {
    if (configQuery.data) {
      setProvider(configQuery.data.provider);
      setBaseUrl(configQuery.data.baseUrl);
      setDefaultModel(configQuery.data.defaultModel);
      setTaskModels(configQuery.data.taskModels || {});
      // Don't overwrite apiKey if user has typed something
      if (!apiKey && configQuery.data.hasApiKey) {
        setApiKey(""); // Keep empty, show placeholder
      }
    }
  }, [configQuery.data]);

  // Auto-fill base URL when provider changes
  useEffect(() => {
    if (provider === "openrouter") {
      setBaseUrl("https://openrouter.ai/api/v1");
      if (!defaultModel) setDefaultModel("anthropic/claude-sonnet-4");
    } else if (provider === "openai") {
      setBaseUrl("https://api.openai.com/v1");
      if (!defaultModel) setDefaultModel("gpt-4.1-mini");
    } else if (provider === "builtin") {
      setBaseUrl("");
      setDefaultModel("gemini-2.5-flash");
    }
  }, [provider]);

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({
        provider,
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
        defaultModel: defaultModel || undefined,
        taskModels: Object.keys(taskModels).length > 0 ? taskModels : undefined,
      });
      toast.success("LLM 配置已更新");
      configQuery.refetch();
    } catch (err: any) {
      toast.error(`保存失败: ${err.message}`);
    }
  };

  const handleTest = async () => {
    if (provider === "builtin") {
      toast.info("内置服务无需测试连接");
      return;
    }
    if (!apiKey) {
      toast.error("请输入 API Key");
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync({
        provider,
        baseUrl: baseUrl || undefined,
        apiKey,
        model: defaultModel || undefined,
      });
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setIsTesting(false);
    }
  };

  const isExternalProvider = provider !== "builtin";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border/40 bg-card/50 backdrop-blur-sm">
        <div className="container max-w-4xl py-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">系统设置</h1>
              <p className="text-sm text-muted-foreground">配置 LLM 服务和全局选项</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container max-w-4xl py-6 space-y-6">
        {/* LLM Provider Configuration */}
        <Card className="border-border/40 bg-card/80">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-cyan-400" />
              LLM 服务配置
            </CardTitle>
            <CardDescription>
              选择 LLM 服务提供商并配置连接参数。内置服务无需额外配置。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">服务提供商</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">{opt.desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* External Provider Fields */}
            {isExternalProvider && (
              <>
                {/* API Key */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">API Key</Label>
                  <div className="relative">
                    <Input
                      type={showApiKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={configQuery.data?.hasApiKey ? "••••••••（已保存，留空保持不变）" : "输入 API Key..."}
                      className="bg-background/50 pr-10 font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* Base URL */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Base URL</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="bg-background/50 font-mono text-sm"
                    disabled={provider === "openrouter"}
                  />
                  {provider === "openrouter" && (
                    <p className="text-xs text-muted-foreground">OpenRouter 使用固定 Base URL</p>
                  )}
                </div>
              </>
            )}

            {/* Default Model */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">默认模型</Label>
              <Input
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder={provider === "openrouter" ? "anthropic/claude-sonnet-4" : "gpt-4.1-mini"}
                className="bg-background/50 font-mono text-sm"
                disabled={provider === "builtin"}
              />
              {provider === "builtin" && (
                <p className="text-xs text-muted-foreground">内置服务使用 gemini-2.5-flash</p>
              )}
              {provider === "openrouter" && (
                <p className="text-xs text-muted-foreground">
                  OpenRouter 模型格式：provider/model-name，如 anthropic/claude-sonnet-4
                </p>
              )}
            </div>

            {/* Advanced: Per-task model overrides */}
            <div className="border border-border/30 rounded-lg">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-accent/30 rounded-lg transition-colors"
              >
                <span>高级选项：按任务类型配置模型</span>
                {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {showAdvanced && (
                <div className="px-3 pb-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    为不同任务类型指定不同的模型。留空则使用上方的默认模型。
                  </p>
                  {TASK_TYPES.map((task) => (
                    <div key={task.key} className="flex items-center gap-3">
                      <div className="w-28 shrink-0">
                        <Label className="text-xs">{task.label}</Label>
                        <p className="text-[10px] text-muted-foreground">{task.desc}</p>
                      </div>
                      <Input
                        value={taskModels[task.key] || ""}
                        onChange={(e) =>
                          setTaskModels((prev) => ({
                            ...prev,
                            [task.key]: e.target.value,
                          }))
                        }
                        placeholder={`使用默认模型 (${defaultModel || "..."})`}
                        className="bg-background/50 font-mono text-xs h-8"
                        disabled={provider === "builtin"}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存配置
              </Button>
              {isExternalProvider && (
                <Button variant="outline" onClick={handleTest} disabled={isTesting} className="gap-2">
                  {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  测试连接
                </Button>
              )}
            </div>

            {/* Test Result */}
            {testResult && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  testResult.success
                    ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border border-red-500/30 text-red-400"
                }`}
              >
                {testResult.success ? (
                  <div>
                    <p className="font-medium">✓ 连接成功</p>
                    {testResult.reply && <p className="mt-1 text-xs opacity-80">模型回复：{testResult.reply}</p>}
                  </div>
                ) : (
                  <div>
                    <p className="font-medium">✗ 连接失败</p>
                    {testResult.error && <p className="mt-1 text-xs opacity-80">{testResult.error}</p>}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Prompt Template Management */}
        <Card className="border-border/40 bg-card/80 cursor-pointer hover:border-cyan-500/30 transition-colors" onClick={() => setLocation("/settings/templates")}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">Prompt 模板管理</h3>
                  <p className="text-xs text-muted-foreground">管理预设和自定义 Prompt 模板，导入 Skill</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        {/* Current Status */}
        <Card className="border-border/40 bg-card/80">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">当前状态</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">提供商：</span>
                <span className="ml-2 font-medium">
                  {PROVIDER_OPTIONS.find((p) => p.value === (configQuery.data?.provider || "builtin"))?.label || "内置"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">默认模型：</span>
                <span className="ml-2 font-mono text-xs">{configQuery.data?.defaultModel || "gemini-2.5-flash"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">API Key：</span>
                <span className="ml-2">
                  {configQuery.data?.hasApiKey ? (
                    <span className="text-emerald-400">已配置</span>
                  ) : (
                    <span className="text-yellow-400">
                      {(configQuery.data?.provider || "builtin") === "builtin" ? "使用内置" : "未配置"}
                    </span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">版本：</span>
                <span className="ml-2 font-mono text-xs">V0.5</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
