import { useCortexAuth } from "@/hooks/useCortexAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Brain, Plus, FolderOpen, FileText, Loader2, LogOut, Shield } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function ProjectList() {
  const { user, loading, logout } = useCortexAuth();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Use authenticated project listing (context.ts handles cortex auth automatically)
  const { data: projects, isLoading, refetch } = trpc.project.list.useQuery(
    undefined,
    { enabled: !!user },
  );

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (result) => {
      toast.success("项目创建成功");
      setOpen(false);
      setName("");
      setDescription("");
      refetch();
      setLocation(`/project/${result.id}`);
    },
    onError: (err) => toast.error(`创建失败: ${err.message}`),
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  // Should not reach here if not authenticated (App.tsx handles redirect)
  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="container max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="h-5 w-5 text-cyan-400" />
            <span className="font-semibold tracking-tight text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              CORTEX
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              {user.displayName || user.username}
              {user.role === "admin" && <Shield className="w-3.5 h-3.5 text-cyan-400" />}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              项目列表
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              选择一个项目进入工作区，或创建新项目
            </p>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-cyan-600 hover:bg-cyan-500 text-white">
                <Plus className="h-4 w-4" />
                新建项目
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">新建项目</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  创建一个新的对话资产项目
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">项目名称</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：金瓶梅研究"
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">项目描述</label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="简要描述项目内容和目标..."
                    className="bg-background border-border resize-none"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => createMutation.mutate({
                    name,
                    description: description || undefined,
                  })}
                  disabled={!name.trim() || createMutation.isPending}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white"
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  创建
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Projects Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="bg-card border-border hover:border-cyan-500/40 transition-all cursor-pointer group"
                onClick={() => setLocation(`/project/${project.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0 group-hover:bg-cyan-500/20 transition-colors">
                      <FolderOpen className="h-5 w-5 text-cyan-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-foreground truncate group-hover:text-cyan-400 transition-colors">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {project.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-3">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {project.docCount} 个文档
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(project.createdAt).toLocaleDateString("zh-CN")}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            <FolderOpen className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg">还没有任何项目</p>
            <p className="text-sm mt-2">点击「新建项目」开始构建你的知识图谱</p>
          </div>
        )}
      </main>
    </div>
  );
}
