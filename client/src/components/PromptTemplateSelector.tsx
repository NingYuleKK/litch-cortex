import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileText, ChevronDown, Loader2 } from "lucide-react";

interface Props {
  /** Called when the selected template changes, passes the systemPrompt text */
  onTemplateChange?: (templateId: string, systemPrompt: string) => void;
  /** Compact mode for inline use */
  compact?: boolean;
  /** CSS class */
  className?: string;
}

const STORAGE_KEY = "cortex-selected-template-id";

function getSavedTemplateId(): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

function saveTemplateId(id: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(id));
  } catch {}
}

export default function PromptTemplateSelector({ onTemplateChange, compact, className }: Props) {
  const templatesQuery = trpc.promptTemplate.list.useQuery();
  const templates = templatesQuery.data || [];

  const [selectedId, setSelectedId] = useState<number | null>(() => getSavedTemplateId());

  const selectedTemplate = useMemo(() => {
    if (!templates.length) return null;
    const found = templates.find((t: any) => t.id === selectedId);
    return found || templates[0]; // default to first (academic)
  }, [templates, selectedId]);

  function handleSelect(template: any) {
    setSelectedId(template.id);
    saveTemplateId(template.id);
    onTemplateChange?.(String(template.id), template.systemPrompt);
  }

  if (templatesQuery.isLoading) {
    return (
      <div className={className}>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled>
          <Loader2 className="h-3 w-3 animate-spin" />
          加载模板...
        </Button>
      </div>
    );
  }

  const presets = templates.filter((t: any) => t.isPreset === 1);
  const customs = templates.filter((t: any) => t.isPreset !== 1);

  if (compact) {
    return (
      <div className={`flex items-center gap-1 ${className || ""}`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs border-border bg-background hover:bg-accent/50 max-w-[160px]"
            >
              <FileText className="h-3 w-3 text-cyan-400 shrink-0" />
              <span className="truncate">{selectedTemplate?.name || "选择模板"}</span>
              <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-card border-border" sideOffset={4}>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              预设模板
            </div>
            <DropdownMenuSeparator />
            {presets.map((t: any) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => handleSelect(t)}
                className={`cursor-pointer text-xs ${selectedId === t.id ? "bg-accent text-accent-foreground" : ""}`}
              >
                <div className="flex flex-col gap-0.5 w-full">
                  <span className="font-medium">{t.name}</span>
                  {t.description && (
                    <span className="text-muted-foreground text-[10px] leading-tight">{t.description}</span>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
            {customs.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  自定义模板
                </div>
                {customs.map((t: any) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => handleSelect(t)}
                    className={`cursor-pointer text-xs ${selectedId === t.id ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    <div className="flex flex-col gap-0.5 w-full">
                      <span className="font-medium">{t.name}</span>
                      {t.description && (
                        <span className="text-muted-foreground text-[10px] leading-tight">{t.description}</span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
        {templates.map((t: any) => (
          <Button
            key={t.id}
            variant={selectedId === t.id || (!selectedId && t.isPreset === 1 && templates.indexOf(t) === 0) ? "default" : "outline"}
            size="sm"
            className={`h-8 text-xs ${
              selectedId === t.id || (!selectedId && t.isPreset === 1 && templates.indexOf(t) === 0)
                ? "bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-600"
                : "border-border hover:bg-accent/50"
            }`}
            onClick={() => handleSelect(t)}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {/* Preview current prompt */}
      {selectedTemplate && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3 max-h-36 overflow-y-auto whitespace-pre-wrap border border-border/50 font-mono">
          {selectedTemplate.systemPrompt.substring(0, 300)}
          {selectedTemplate.systemPrompt.length > 300 ? "..." : ""}
        </div>
      )}
    </div>
  );
}
