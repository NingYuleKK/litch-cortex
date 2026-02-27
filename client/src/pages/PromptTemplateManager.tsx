import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Edit2,
  Trash2,
  FileText,
  Import,
  Loader2,
  Lock,
  Sparkles,
  Upload,
  FileUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Link } from "wouter";

export default function PromptTemplateManager() {
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [importText, setImportText] = useState("");
  const [importName, setImportName] = useState("");

  const templatesQuery = trpc.promptTemplate.list.useQuery();
  const createMutation = trpc.promptTemplate.create.useMutation();
  const updateMutation = trpc.promptTemplate.update.useMutation();
  const deleteMutation = trpc.promptTemplate.delete.useMutation();
  const importFileMutation = trpc.promptTemplate.importFile.useMutation();

  const templates = templatesQuery.data || [];
  const presets = templates.filter((t: any) => t.isPreset === 1);
  const customs = templates.filter((t: any) => t.isPreset !== 1);

  const resetForm = () => {
    setName("");
    setDescription("");
    setSystemPrompt("");
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!name.trim() || !systemPrompt.trim()) {
      toast.error("请填写模板名称和 Prompt 内容");
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
      });
      toast.success("模板创建成功");
      resetForm();
      setShowCreate(false);
      templatesQuery.refetch();
    } catch (err: any) {
      toast.error(`创建失败: ${err.message}`);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !name.trim() || !systemPrompt.trim()) {
      toast.error("请填写模板名称和 Prompt 内容");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
      });
      toast.success("模板更新成功");
      resetForm();
      templatesQuery.refetch();
    } catch (err: any) {
      toast.error(`更新失败: ${err.message}`);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteMutation.mutateAsync({ id: deletingId });
      toast.success("模板已删除");
      setDeletingId(null);
      templatesQuery.refetch();
    } catch (err: any) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const handleImportSkill = async () => {
    if (!importText.trim()) {
      toast.error("请粘贴 Skill 内容");
      return;
    }
    const finalName = importName.trim() || "导入的 Skill 模板";
    try {
      await createMutation.mutateAsync({
        name: finalName,
        description: "从 Skill 导入",
        systemPrompt: importText.trim(),
      });
      toast.success("Skill 导入成功");
      setImportText("");
      setImportName("");
      setShowImport(false);
      templatesQuery.refetch();
    } catch (err: any) {
      toast.error(`导入失败: ${err.message}`);
    }
  };

  // File import handler
  const handleFileImport = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["skill", "md"].includes(ext)) {
      toast.error("仅支持 .skill 和 .md 文件");
      return;
    }

    setIsImportingFile(true);
    try {
      // Read file as base64
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      // Convert to base64 in chunks to avoid stack overflow
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const result = await importFileMutation.mutateAsync({
        fileName: file.name,
        fileContent: base64,
        fileType: ext as "skill" | "md",
      });

      toast.success(`已导入模板"${result.name}"（${result.contentLength} 字符）`);
      templatesQuery.refetch();
    } catch (err: any) {
      toast.error(`文件导入失败: ${err.message}`);
    } finally {
      setIsImportingFile(false);
    }
  }, [importFileMutation, templatesQuery]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileImport(files[0]);
    }
  }, [handleFileImport]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const startEdit = (template: any) => {
    setName(template.name);
    setDescription(template.description || "");
    setSystemPrompt(template.systemPrompt);
    setEditingId(template.id);
    setShowCreate(false);
  };

  const cancelEdit = () => {
    resetForm();
  };

  // Template card with preview
  const TemplateCard = ({ t, isPreset }: { t: any; isPreset: boolean }) => {
    const isExpanded = expandedId === t.id;
    const charCount = t.systemPrompt?.length || 0;
    const previewLines = t.systemPrompt?.split("\n").slice(0, 3).join("\n") || "";
    const hasMore = t.systemPrompt?.split("\n").length > 3 || charCount > 300;

    return (
      <Card className="border-border/30 bg-card/60">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <FileText className={`h-4 w-4 shrink-0 ${isPreset ? "text-cyan-400" : "text-emerald-400"}`} />
                <h3 className="font-medium text-sm">{t.name}</h3>
                <span className="text-[10px] text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded">
                  {charCount.toLocaleString()} 字符
                </span>
              </div>
              {t.description && (
                <p className="text-xs text-muted-foreground mb-2">{t.description}</p>
              )}
              <pre className="text-xs text-muted-foreground/70 bg-background/50 rounded p-2 overflow-auto whitespace-pre-wrap font-mono"
                style={{ maxHeight: isExpanded ? "none" : "80px" }}
              >
                {isExpanded ? t.systemPrompt : previewLines}
                {!isExpanded && hasMore ? "\n..." : ""}
              </pre>
              {hasMore && (
                <button
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 mt-1 flex items-center gap-0.5"
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                >
                  {isExpanded ? (
                    <>收起 <ChevronUp className="h-3 w-3" /></>
                  ) : (
                    <>展开全部 ({charCount.toLocaleString()} 字符) <ChevronDown className="h-3 w-3" /></>
                  )}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => startEdit(t)}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              {!isPreset && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setDeletingId(t.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border/40 bg-card/50 backdrop-blur-sm">
        <div className="container max-w-4xl py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/settings">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Prompt 模板管理</h1>
                <p className="text-sm text-muted-foreground">
                  管理预设和自定义 Prompt 模板，用于话题探索和摘要生成
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setShowImport(true)}
              >
                <Import className="h-3.5 w-3.5" />
                导入 Skill
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  resetForm();
                  setShowCreate(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                新建模板
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container max-w-4xl py-6 space-y-6">
        {/* File Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
            isDragOver
              ? "border-cyan-500/60 bg-cyan-500/5"
              : "border-border/40 bg-card/30 hover:border-border/60"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".skill,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileImport(file);
              e.target.value = "";
            }}
          />
          {isImportingFile ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              正在解析文件...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <FileUp className="h-8 w-8 text-muted-foreground/50" />
              <div className="text-sm text-muted-foreground">
                拖入 <span className="font-mono text-cyan-400">.skill</span> 或{" "}
                <span className="font-mono text-cyan-400">.md</span> 文件导入模板
              </div>
              <div className="text-xs text-muted-foreground/60">
                .skill 文件会自动解压提取 SKILL.md 内容
              </div>
            </div>
          )}
        </div>

        {/* Preset Templates */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" />
            预设模板（不可删除）
          </h2>
          <div className="grid gap-3">
            {presets.map((t: any) => (
              <TemplateCard key={t.id} t={t} isPreset={true} />
            ))}
          </div>
        </div>

        {/* Custom Templates */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            自定义模板
          </h2>
          {customs.length === 0 ? (
            <Card className="border-border/30 bg-card/40 border-dashed">
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  还没有自定义模板。点击"新建模板"或"导入 Skill"开始创建。
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {customs.map((t: any) => (
                <TemplateCard key={t.id} t={t} isPreset={false} />
              ))}
            </div>
          )}
        </div>

        {/* Edit Form (inline) */}
        {editingId && (
          <Card className="border-cyan-500/30 bg-card/80">
            <CardHeader>
              <CardTitle className="text-base">编辑模板</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">模板名称</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">描述（可选）</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-background/50"
                  placeholder="简短描述模板用途..."
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">System Prompt</Label>
                  <span className="text-[10px] text-muted-foreground">
                    {systemPrompt.length.toLocaleString()} 字符
                  </span>
                </div>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="bg-background/50 font-mono text-xs min-h-[200px] resize-y"
                  placeholder="输入 system prompt..."
                  style={{ maxHeight: "600px" }}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleUpdate} disabled={updateMutation.isPending} className="gap-2">
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存修改
                </Button>
                <Button variant="outline" onClick={cancelEdit}>
                  取消
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建 Prompt 模板</DialogTitle>
            <DialogDescription>创建自定义 Prompt 模板，用于话题探索和摘要生成</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>模板名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：技术分析、创意写作..."
              />
            </div>
            <div className="space-y-2">
              <Label>描述（可选）</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简短描述模板用途..."
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>System Prompt</Label>
                <span className="text-[10px] text-muted-foreground">
                  {systemPrompt.length.toLocaleString()} 字符
                </span>
              </div>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="输入 system prompt 内容..."
                className="font-mono text-xs min-h-[200px] resize-y"
                style={{ maxHeight: "500px" }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Skill Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Import className="h-5 w-5" />
              导入 Skill
            </DialogTitle>
            <DialogDescription>
              粘贴 Claude Skill 或其他 AI 工具的 Prompt 内容，导入为 Cortex 模板
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>模板名称</Label>
              <Input
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="例如：对话转 Blog"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Skill Prompt 内容</Label>
                <span className="text-[10px] text-muted-foreground">
                  {importText.length.toLocaleString()} 字符
                </span>
              </div>
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="粘贴 Skill 的完整 prompt 内容..."
                className="font-mono text-xs min-h-[250px] resize-y"
                style={{ maxHeight: "500px" }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImport(false)}>
              取消
            </Button>
            <Button onClick={handleImportSkill} disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              删除后无法恢复。确定要删除这个模板吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="gap-2"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
