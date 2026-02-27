import { useState } from "react";
import {
  PRESET_TEMPLATES,
  getSelectedTemplateId,
  saveSelectedTemplateId,
  getCustomPrompt,
  saveCustomPrompt,
} from "@/lib/promptTemplates";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FileText, ChevronDown, Save, Info } from "lucide-react";
import { toast } from "sonner";

interface Props {
  /** Called when the selected template changes */
  onTemplateChange?: (templateId: string) => void;
  /** Compact mode for inline use */
  compact?: boolean;
  /** CSS class */
  className?: string;
}

export default function PromptTemplateSelector({ onTemplateChange, compact, className }: Props) {
  const [selectedId, setSelectedId] = useState(() => getSelectedTemplateId());
  const [customPrompt, setCustomPrompt] = useState(() => getCustomPrompt());
  const [showCustomDialog, setShowCustomDialog] = useState(false);

  const selectedTemplate = PRESET_TEMPLATES.find(t => t.id === selectedId) || PRESET_TEMPLATES[0];

  function handleSelect(id: string) {
    setSelectedId(id);
    saveSelectedTemplateId(id);
    onTemplateChange?.(id);

    if (id === "custom") {
      setShowCustomDialog(true);
    }
  }

  function handleSaveCustom() {
    saveCustomPrompt(customPrompt);
    toast.success("自定义 Prompt 已保存");
    setShowCustomDialog(false);
  }

  // Custom prompt editor dialog (shared between compact and full modes)
  const customDialog = (
    <Dialog open={showCustomDialog} onOpenChange={setShowCustomDialog}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <FileText className="h-4 w-4 text-cyan-400" />
            自定义 Prompt
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3.5 w-3.5 shrink-0" />
            描述你希望 LLM 如何处理文本片段，保存后在话题探索和摘要生成中生效
          </p>
          <Textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={"输入你的自定义 Prompt...\n\n例如：你是一个专业的法律文书分析助手，请根据提供的文本片段，提炼关键法律条款和判决要点..."}
            className="bg-background border-border resize-none min-h-[160px] text-sm font-mono"
            rows={8}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowCustomDialog(false)}>取消</Button>
          <Button
            className="bg-cyan-600 hover:bg-cyan-500 text-white"
            onClick={handleSaveCustom}
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            保存 Prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (compact) {
    return (
      <div className={`flex items-center gap-1 ${className || ""}`}>
        {/* Use DropdownMenu instead of Popover+Select to avoid Radix Portal nesting conflicts */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs border-border bg-background hover:bg-accent/50 max-w-[140px]"
            >
              <FileText className="h-3 w-3 text-cyan-400 shrink-0" />
              <span className="truncate">{selectedTemplate.label}</span>
              <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 bg-card border-border" sideOffset={4}>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Prompt 模板
            </div>
            <DropdownMenuSeparator />
            {PRESET_TEMPLATES.filter(t => !t.isCustom).map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => handleSelect(t.id)}
                className={`cursor-pointer text-xs ${selectedId === t.id ? "bg-accent text-accent-foreground" : ""}`}
              >
                <div className="flex flex-col gap-0.5 w-full">
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted-foreground text-[10px] leading-tight">{t.description}</span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleSelect("custom")}
              className={`cursor-pointer text-xs ${selectedId === "custom" ? "bg-accent text-accent-foreground" : ""}`}
            >
              <div className="flex flex-col gap-0.5 w-full">
                <span className="font-medium">自定义</span>
                <span className="text-muted-foreground text-[10px] leading-tight">
                  {customPrompt ? "已设置自定义 Prompt" : "使用你自己编写的 Prompt"}
                </span>
              </div>
            </DropdownMenuItem>
            {selectedId === "custom" && customPrompt && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowCustomDialog(true)}
                  className="cursor-pointer text-xs text-cyan-400"
                >
                  <Save className="h-3 w-3 mr-1" />
                  编辑自定义 Prompt
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {customDialog}
      </div>
    );
  }

  // Full-size mode (used in Explore page)
  return (
    <div className={`space-y-3 ${className || ""}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FileText className="h-4 w-4 text-cyan-400" />
        Prompt 模板
      </div>

      {/* Template buttons */}
      <div className="flex flex-wrap gap-2">
        {PRESET_TEMPLATES.map((t) => (
          <Button
            key={t.id}
            variant={selectedId === t.id ? "default" : "outline"}
            size="sm"
            className={`h-8 text-xs ${
              selectedId === t.id
                ? "bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-600"
                : "border-border hover:bg-accent/50"
            }`}
            onClick={() => handleSelect(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Preview current prompt */}
      {!selectedTemplate.isCustom && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 max-h-36 overflow-y-auto whitespace-pre-wrap border border-border/50">
          {selectedTemplate.systemPrompt}
        </div>
      )}

      {/* Custom prompt summary */}
      {selectedId === "custom" && (
        <div className="space-y-2">
          {customPrompt ? (
            <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 max-h-24 overflow-y-auto whitespace-pre-wrap border border-border/50">
              {customPrompt}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">尚未设置自定义 Prompt</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
            onClick={() => setShowCustomDialog(true)}
          >
            <Save className="h-3 w-3 mr-1" />
            {customPrompt ? "编辑" : "设置"} 自定义 Prompt
          </Button>
        </div>
      )}

      {customDialog}
    </div>
  );
}
