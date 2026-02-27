import { useState, useEffect } from "react";
import {
  PRESET_TEMPLATES,
  getSelectedTemplateId,
  saveSelectedTemplateId,
  getCustomPrompt,
  saveCustomPrompt,
  type PromptTemplate,
} from "@/lib/promptTemplates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [showCustomEditor, setShowCustomEditor] = useState(false);

  const selectedTemplate = PRESET_TEMPLATES.find(t => t.id === selectedId) || PRESET_TEMPLATES[0];

  function handleSelect(id: string) {
    setSelectedId(id);
    saveSelectedTemplateId(id);
    onTemplateChange?.(id);

    if (id === "custom") {
      setShowCustomEditor(true);
    } else {
      setShowCustomEditor(false);
    }
  }

  function handleSaveCustom() {
    saveCustomPrompt(customPrompt);
    toast.success("自定义 Prompt 已保存");
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className || ""}`}>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs border-border bg-background hover:bg-accent/50"
            >
              <FileText className="h-3.5 w-3.5 text-cyan-400" />
              <span className="hidden sm:inline">{selectedTemplate.label}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-3" align="start">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FileText className="h-4 w-4 text-cyan-400" />
                Prompt 模板
              </div>

              <Select value={selectedId} onValueChange={handleSelect}>
                <SelectTrigger className="h-8 text-xs bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_TEMPLATES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <span>{t.label}</span>
                        <span className="text-muted-foreground text-[10px]">
                          {t.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Preview current prompt */}
              {!selectedTemplate.isCustom && (
                <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-md p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {selectedTemplate.systemPrompt}
                </div>
              )}

              {/* Custom prompt editor */}
              {selectedId === "custom" && (
                <div className="space-y-2">
                  <Textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="输入你的自定义 Prompt...&#10;&#10;提示：描述你希望 LLM 如何处理文本片段"
                    className="text-xs bg-background border-border resize-none min-h-[120px]"
                    rows={6}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      保存后在话题探索和摘要生成中生效
                    </span>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-cyan-600 hover:bg-cyan-500 text-white"
                      onClick={handleSaveCustom}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      保存
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // Full-size mode
  return (
    <div className={`space-y-3 ${className || ""}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FileText className="h-4 w-4 text-cyan-400" />
        Prompt 模板
      </div>

      <Select value={selectedId} onValueChange={handleSelect}>
        <SelectTrigger className="bg-background border-border">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESET_TEMPLATES.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <div>
                <span className="font-medium">{t.label}</span>
                <span className="text-muted-foreground text-xs ml-2">
                  {t.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Preview */}
      {!selectedTemplate.isCustom && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap border border-border/50">
          {selectedTemplate.systemPrompt}
        </div>
      )}

      {/* Custom editor */}
      {selectedId === "custom" && (
        <div className="space-y-2">
          <Textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="输入你的自定义 Prompt...&#10;&#10;提示：描述你希望 LLM 如何处理文本片段"
            className="bg-background border-border resize-none min-h-[150px]"
            rows={8}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3.5 w-3.5" />
              保存后在话题探索和摘要生成中生效
            </span>
            <Button
              size="sm"
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
              onClick={handleSaveCustom}
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              保存 Prompt
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
