import { useState, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Eye, EyeOff, Save, Zap, ChevronDown, ChevronRight, Loader2, FileText, ArrowRight, Search, X, Brain } from "lucide-react";
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

// ─── Model Search Combobox ───────────────────────────────────────────

interface ModelOption {
  id: string;
  name: string;
  context_length?: number;
  pricing?: any;
}

function ModelCombobox({
  value,
  onChange,
  models,
  isLoading,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  models: ModelOption[];
  isLoading: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search) return models.slice(0, 100); // Show first 100 by default
    const q = search.toLowerCase();
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    ).slice(0, 100);
  }, [models, search]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (models.length === 0 && !isLoading) {
    // Fallback to plain input when no models available
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "输入模型名称..."}
        className={`bg-background/50 font-mono text-sm ${className || ""}`}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={open ? search : value}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setSearch("");
          }}
          placeholder={placeholder || "搜索模型..."}
          className={`bg-background/50 font-mono text-xs pl-8 pr-8 ${className || ""}`}
          disabled={disabled || isLoading}
        />
        {value && !open && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
            onClick={() => {
              onChange("");
              setSearch("");
              inputRef.current?.focus();
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
        {isLoading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {filtered.map((m) => (
            <button
              key={m.id}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors flex items-center justify-between ${
                m.id === value ? "bg-accent/30" : ""
              }`}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
                setSearch("");
              }}
            >
              <div className="flex flex-col min-w-0">
                <span className="font-mono truncate">{m.id}</span>
                {m.name !== m.id && (
                  <span className="text-[10px] text-muted-foreground truncate">{m.name}</span>
                )}
              </div>
              {m.context_length && (
                <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                  {(m.context_length / 1000).toFixed(0)}K
                </span>
              )}
            </button>
          ))}
          {filtered.length === 100 && (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground text-center">
              显示前 100 个结果，请输入关键词过滤
            </div>
          )}
        </div>
      )}
    </div>
  );
}

//// ─── Embedding Config Section ──────────────────────────────────────

const EMBEDDING_PROVIDERS = [
  { value: "openrouter", label: "OpenRouter", desc: "openrouter.ai — 推荐，支持 openai/text-embedding-3-small" },
  { value: "openai", label: "OpenAI", desc: "api.openai.com — text-embedding-3-small / large" },
  { value: "builtin", label: "内置服务", desc: "平台内置 API（不支持 embedding，仅作 fallback）" },
  { value: "custom", label: "自定义", desc: "自定义 OpenAI 兼容 Embedding API" },
];

function EmbeddingConfigSection() {
  const [embProvider, setEmbProvider] = useState("openrouter");
  const [embBaseUrl, setEmbBaseUrl] = useState("https://openrouter.ai/api/v1");
  const [embApiKey, setEmbApiKey] = useState("");
  const [embModel, setEmbModel] = useState("openai/text-embedding-3-small");
  const [embDimensions, setEmbDimensions] = useState(1536);
  const [showEmbApiKey, setShowEmbApiKey] = useState(false);
  const [reusingLlmKey, setReusingLlmKey] = useState(false);

  const embConfigQuery = trpc.embedding.getConfig.useQuery();
  const embSaveMutation = trpc.embedding.saveConfig.useMutation();

  useEffect(() => {
    if (embConfigQuery.data) {
      // Use dbProvider (raw saved value) for form state, not resolved/fallback provider
      const savedProvider = (embConfigQuery.data as any).dbProvider || embConfigQuery.data.provider || "openrouter";
      setEmbProvider(savedProvider);
      setEmbBaseUrl(embConfigQuery.data.baseUrl || (savedProvider === "openrouter" ? "https://openrouter.ai/api/v1" : ""));
      setEmbModel(embConfigQuery.data.model || (savedProvider === "openrouter" ? "openai/text-embedding-3-small" : "text-embedding-3-small"));
      setEmbDimensions(embConfigQuery.data.dimensions || 1536);
    }
  }, [embConfigQuery.data]);

  useEffect(() => {
    setReusingLlmKey(false);
    if (embProvider === "openai") {
      setEmbBaseUrl("https://api.openai.com/v1");
      setEmbModel((m) => (m === "openai/text-embedding-3-small" ? "text-embedding-3-small" : m));
    } else if (embProvider === "openrouter") {
      setEmbBaseUrl("https://openrouter.ai/api/v1");
      setEmbModel((m) => (m === "text-embedding-3-small" ? "openai/text-embedding-3-small" : m));
    } else if (embProvider === "builtin") {
      setEmbBaseUrl("");
      setEmbModel("text-embedding-3-small");
      setEmbDimensions(1536);
    }
  }, [embProvider]);

  const handleEmbSave = async () => {
    try {
      // If reusingLlmKey, save without apiKey so backend auto-reuses LLM OpenRouter key
      const apiKeyToSend = reusingLlmKey ? undefined : (embApiKey || undefined);
      await embSaveMutation.mutateAsync({
        provider: embProvider,
        baseUrl: embBaseUrl || undefined,
        apiKey: apiKeyToSend,
        model: embModel || undefined,
        dimensions: embDimensions || undefined,
      });
      toast.success("Embedding 配置已保存");
      setEmbApiKey("");
      setReusingLlmKey(false);
      embConfigQuery.refetch();
    } catch (err: any) {
      toast.error(`保存失败: ${err.message}`);
    }
  };

  const isEmbExternal = embProvider !== "builtin";
  const llmHasOpenRouterKey = (embConfigQuery.data as any)?.llmHasOpenRouterKey;

  return (
    <div className="space-y-4">
      {/* Provider */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">服务提供商</Label>
        <Select value={embProvider} onValueChange={setEmbProvider}>
          <SelectTrigger className="bg-background/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMBEDDING_PROVIDERS.map((opt) => (
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

      {isEmbExternal && (
        <>
          {/* API Key */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">API Key</Label>
            {/* Reuse LLM OpenRouter key hint */}
            {embProvider === "openrouter" && llmHasOpenRouterKey && !reusingLlmKey && !embApiKey && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-xs">
                <span className="text-cyan-400">ℹ️ LLM 配置中已有 OpenRouter Key</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 ml-auto"
                  onClick={() => {
                    setReusingLlmKey(true);
                    toast.info("将复用 LLM 配置中的 OpenRouter Key，点保存即可生效");
                  }}
                >
                  一键复用
                </Button>
              </div>
            )}
            {reusingLlmKey && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs">
                <span className="text-emerald-400">✓ 将复用 LLM 配置中的 OpenRouter Key</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-xs text-muted-foreground hover:text-foreground ml-auto"
                  onClick={() => setReusingLlmKey(false)}
                >
                  取消
                </Button>
              </div>
            )}
            {!reusingLlmKey && (
              <div className="relative">
                <Input
                  type={showEmbApiKey ? "text" : "password"}
                  value={embApiKey}
                  onChange={(e) => setEmbApiKey(e.target.value)}
                  placeholder={
                    embConfigQuery.data?.hasApiKey
                      ? "········（已保存，留空保持不变）"
                      : embProvider === "openrouter" && llmHasOpenRouterKey
                      ? "留空将自动复用 LLM 配置中的 OpenRouter Key"
                      : "输入 API Key..."
                  }
                  className="bg-background/50 pr-10 font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowEmbApiKey(!showEmbApiKey)}
                >
                  {showEmbApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            )}
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Base URL</Label>
            <Input
              value={embBaseUrl}
              onChange={(e) => setEmbBaseUrl(e.target.value)}
              placeholder={embProvider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1"}
              className="bg-background/50 font-mono text-sm"
            />
          </div>
        </>
      )}

      {/* Model */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Embedding 模型</Label>
        <Input
          value={embModel}
          onChange={(e) => setEmbModel(e.target.value)}
          placeholder="text-embedding-3-small"
          className="bg-background/50 font-mono text-sm"
          disabled={embProvider === "builtin"}
        />
        {embProvider === "builtin" && (
          <p className="text-xs text-muted-foreground">内置服务使用 text-embedding-3-small</p>
        )}
      </div>

      {/* Dimensions */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">向量维度</Label>
        <Input
          type="number"
          value={embDimensions}
          onChange={(e) => setEmbDimensions(parseInt(e.target.value) || 1536)}
          placeholder="1536"
          className="bg-background/50 font-mono text-sm w-32"
          disabled={embProvider === "builtin"}
        />
        <p className="text-xs text-muted-foreground">
          text-embedding-3-small 默认 1536 维，text-embedding-3-large 默认 3072 维
        </p>
      </div>

      {/* Save */}
      <div className="pt-2">
        <Button onClick={handleEmbSave} disabled={embSaveMutation.isPending} className="gap-2">
          {embSaveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存 Embedding 配置
        </Button>
      </div>

      {/* Current status */}
      {embConfigQuery.data && (
        <div className="p-3 rounded-lg bg-muted/30 border border-border/30 text-xs text-muted-foreground">
          <span>当前: </span>
          <span className="font-mono">{embConfigQuery.data.provider}</span>
          <span> / </span>
          <span className="font-mono">{embConfigQuery.data.model}</span>
          <span> / </span>
          <span>{embConfigQuery.data.dimensions} 维</span>
          <span> / API Key: </span>
          <span className={embConfigQuery.data.hasApiKey ? "text-emerald-400" : "text-amber-400"}>
            {embConfigQuery.data.hasApiKey ? "已配置" : embConfigQuery.data.provider === "builtin" ? "使用内置" : "未配置"}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────────────

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

  // Model list state
  const [modelList, setModelList] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  const configQuery = trpc.llmSettings.getConfig.useQuery();
  const saveMutation = trpc.llmSettings.saveConfig.useMutation();
  const testMutation = trpc.llmSettings.testConnection.useMutation();
  const fetchModelsMutation = trpc.llmSettings.fetchModels.useMutation();

  // Load config from server
  useEffect(() => {
    if (configQuery.data) {
      setProvider(configQuery.data.provider);
      setBaseUrl(configQuery.data.baseUrl);
      setDefaultModel(configQuery.data.defaultModel);
      setTaskModels(configQuery.data.taskModels || {});
      if (!apiKey && configQuery.data.hasApiKey) {
        setApiKey("");
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
    // Reset model list when provider changes
    setModelList([]);
    setModelsLoaded(false);
  }, [provider]);

  // Fetch models when API key is available and provider supports it
  const handleFetchModels = async () => {
    if (!apiKey || provider === "builtin") return;
    setIsLoadingModels(true);
    try {
      const result = await fetchModelsMutation.mutateAsync({
        provider,
        baseUrl: baseUrl || undefined,
        apiKey,
      });
      if (result.success && result.models) {
        setModelList(result.models);
        setModelsLoaded(true);
        toast.success(`已获取 ${result.models.length} 个可用模型`);
      } else {
        toast.error(`获取模型列表失败: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(`获取模型列表失败: ${err.message}`);
    } finally {
      setIsLoadingModels(false);
    }
  };

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
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">默认模型</Label>
                {isExternalProvider && apiKey && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={handleFetchModels}
                    disabled={isLoadingModels}
                  >
                    {isLoadingModels ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="h-3 w-3" />
                    )}
                    {modelsLoaded ? "刷新模型列表" : "获取模型列表"}
                  </Button>
                )}
              </div>
              <ModelCombobox
                value={defaultModel}
                onChange={setDefaultModel}
                models={modelList}
                isLoading={isLoadingModels}
                disabled={provider === "builtin"}
                placeholder={provider === "openrouter" ? "搜索模型（如 claude）..." : "输入模型名称..."}
              />
              {provider === "builtin" && (
                <p className="text-xs text-muted-foreground">内置服务使用 gemini-2.5-flash</p>
              )}
              {provider === "openrouter" && !modelsLoaded && (
                <p className="text-xs text-muted-foreground">
                  输入 API Key 后点击"获取模型列表"可搜索所有可用模型
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
                      <ModelCombobox
                        value={taskModels[task.key] || ""}
                        onChange={(v) =>
                          setTaskModels((prev) => ({
                            ...prev,
                            [task.key]: v,
                          }))
                        }
                        models={modelList}
                        isLoading={false}
                        disabled={provider === "builtin"}
                        placeholder={`使用默认 (${defaultModel || "..."})`}
                        className="h-8"
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

        {/* Embedding Configuration */}
        <Card className="border-border/40 bg-card/80">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-400" />
              Embedding 向量配置
            </CardTitle>
            <CardDescription>
              配置用于语义搜索的 Embedding 模型。默认使用内置服务，也可配置 OpenAI 的 text-embedding-3-small 等模型。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmbeddingConfigSection />
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
                <span className="ml-2 font-mono text-xs">V0.6</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
