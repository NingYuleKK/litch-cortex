import { useState, useEffect } from "react";
import { useCortexAuth, CortexUser } from "@/hooks/useCortexAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserPlus, Users, Shield, User, Loader2, Trash2, ArrowLeft, Eye, EyeOff, Brain } from "lucide-react";
import { useLocation } from "wouter";

export default function UserManagement() {
  const { user, registerUser, listUsers, deleteUser } = useCortexAuth();
  const [, setLocation] = useLocation();
  const [users, setUsers] = useState<CortexUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "member" as "admin" | "member",
  });
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation dialog
  const [deleteTarget, setDeleteTarget] = useState<CortexUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Password visibility per user
  const [visiblePasswords, setVisiblePasswords] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.username || !formData.password) {
      toast.error("用户名和密码不能为空");
      return;
    }
    setSubmitting(true);
    try {
      await registerUser({
        username: formData.username,
        password: formData.password,
        displayName: formData.displayName || formData.username,
        role: formData.role,
      });
      toast.success(`用户 "${formData.username}" 创建成功`);
      setFormData({ username: "", password: "", displayName: "", role: "member" });
      setShowForm(false);
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteUser(deleteTarget.id);
      toast.success(`用户 "${deleteTarget.username}" 已删除（${result.deletedProjects} 个项目被清除）`);
      setDeleteTarget(null);
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  function togglePasswordVisibility(userId: number) {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>只有管理员可以访问用户管理</p>
          <Button variant="ghost" className="mt-4" onClick={() => setLocation("/")}>
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="container max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setLocation("/")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Brain className="h-5 w-5 text-cyan-400" />
            <span className="font-semibold tracking-tight text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              用户管理
            </span>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xl font-bold text-foreground">用户列表</h1>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-cyan-600 hover:bg-cyan-500 text-white"
            size="sm"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            创建用户
          </Button>
        </div>

        {/* Create User Form */}
        {showForm && (
          <form onSubmit={handleCreate} className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">创建新用户</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">用户名 *</label>
                <Input
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="username"
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">密码 *</label>
                <Input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="password"
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">显示名称</label>
                <Input
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="Display Name"
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">角色</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as "admin" | "member" })}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>
                取消
              </Button>
              <Button type="submit" size="sm" disabled={submitting} className="bg-cyan-600 hover:bg-cyan-500 text-white">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                创建
              </Button>
            </div>
          </form>
        )}

        {/* User List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">用户</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">角色</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">初始密码</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">创建时间</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">最后登录</th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                          {u.role === "admin" ? (
                            <Shield className="w-3.5 h-3.5 text-cyan-400" />
                          ) : (
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{u.displayName || u.username}</div>
                          <div className="text-xs text-muted-foreground">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        u.role === "admin"
                          ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                          : "bg-muted text-muted-foreground border border-border"
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.initialPassword ? (
                        <div className="flex items-center gap-1.5">
                          <code className="text-xs font-mono bg-muted/50 px-1.5 py-0.5 rounded text-foreground/80">
                            {visiblePasswords.has(u.id) ? u.initialPassword : "••••••"}
                          </code>
                          <button
                            onClick={() => togglePasswordVisibility(u.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {visiblePasswords.has(u.id) ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "从未"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== user?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">确认删除用户</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              确定要删除用户 <strong className="text-foreground">@{deleteTarget?.username}</strong> 吗？
              此操作将同时删除该用户的所有项目、文档和数据，且不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
