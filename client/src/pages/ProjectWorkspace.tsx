import { useCortexAuth } from "@/hooks/useCortexAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Upload, FileText, Tags, Brain, LogOut, PanelLeft,
  ChevronLeft, FolderOpen, Loader2, Sparkles, Users, Shield,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";

// Sub-pages
import UploadPage from "./Home";
import ChunksPage from "./Chunks";
import TopicsPage from "./Topics";
import TopicDetailPage from "./TopicDetail";
import ExplorePage from "./Explore";
import UserManagementPage from "./UserManagement";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function ProjectWorkspace() {
  const params = useParams<{ projectId: string; tab?: string; topicId?: string }>();
  const projectId = parseInt(params.projectId || "0");
  const { loading, user } = useCortexAuth();

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  // Should not reach here if not authenticated (App.tsx handles redirect)
  if (!user) return null;

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <WorkspaceContent
        projectId={projectId}
        tab={params.tab}
        topicId={params.topicId}
        setSidebarWidth={setSidebarWidth}
      />
    </SidebarProvider>
  );
}

function WorkspaceContent({
  projectId,
  tab,
  topicId,
  setSidebarWidth,
}: {
  projectId: number;
  tab?: string;
  topicId?: string;
  setSidebarWidth: (w: number) => void;
}) {
  const { user, logout } = useCortexAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const { data: project } = trpc.project.get.useQuery(
    { id: projectId },
    { enabled: projectId > 0 }
  );

  // Determine active tab from URL
  const activeTab = useMemo(() => {
    if (location.match(/^\/project\/\d+\/topics\/\d+$/)) {
      return "topic-detail";
    }
    if (tab === "chunks") return "chunks";
    if (tab === "topics") return "topics";
    if (tab === "explore") return "explore";
    if (tab === "users") return "users";
    return "upload";
  }, [tab, location]);

  const menuItems = [
    { icon: Upload, label: "上传文档", key: "upload", path: `/project/${projectId}` },
    { icon: FileText, label: "分段预览", key: "chunks", path: `/project/${projectId}/chunks` },
    { icon: Tags, label: "话题列表", key: "topics", path: `/project/${projectId}/topics` },
    { icon: Sparkles, label: "话题探索", key: "explore", path: `/project/${projectId}/explore` },
  ];

  // Admin-only menu items
  const adminItems = user?.role === "admin" ? [
    { icon: Users, label: "用户管理", key: "users", path: `/project/${projectId}/users` },
  ] : [];

  const allMenuItems = [...menuItems, ...adminItems];
  const activeMenuItem = allMenuItems.find(item => item.key === activeTab) || menuItems[0];

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  // Extract topicId from URL for topic detail page
  const topicIdFromUrl = useMemo(() => {
    const match = location.match(/^\/project\/\d+\/topics\/(\d+)$/);
    return match ? parseInt(match[1]) : undefined;
  }, [location]);

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none shrink-0"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0">
                  <Brain className="h-5 w-5 text-cyan-400 shrink-0" />
                  <span className="font-semibold tracking-tight truncate text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    CORTEX
                  </span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            {/* Back to projects */}
            <SidebarMenu className="px-2 py-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setLocation("/")}
                  tooltip="返回项目列表"
                  className="h-9 text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="text-xs">返回项目列表</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            {/* Project name */}
            {!isCollapsed && project && (
              <div className="px-4 py-2 mb-1">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">
                    {project.name}
                  </span>
                </div>
                {project.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 pl-6">
                    {project.description}
                  </p>
                )}
              </div>
            )}

            {/* Navigation */}
            <SidebarMenu className="px-2 py-1">
              {menuItems.map(item => {
                const isActive = item.key === activeTab || (item.key === "topics" && activeTab === "topic-detail");
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className="h-10 transition-all font-normal"
                    >
                      <item.icon className={`h-4 w-4 ${isActive ? "text-cyan-400" : ""}`} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>

            {/* Admin section */}
            {adminItems.length > 0 && (
              <>
                {!isCollapsed && (
                  <div className="px-4 py-2 mt-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">管理</span>
                  </div>
                )}
                <SidebarMenu className="px-2">
                  {adminItems.map(item => {
                    const isActive = item.key === activeTab;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => setLocation(item.path)}
                          tooltip={item.label}
                          className="h-10 transition-all font-normal"
                        >
                          <item.icon className={`h-4 w-4 ${isActive ? "text-cyan-400" : ""}`} />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-cyan-500/20 text-cyan-400">
                      {(user?.displayName || user?.username || "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-foreground">
                      {user?.displayName || user?.username || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5 flex items-center gap-1">
                      @{user?.username}
                      {user?.role === "admin" && (
                        <Shield className="w-3 h-3 text-cyan-400 inline" />
                      )}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {user?.role === "admin" ? "管理员" : "成员"}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-cyan-500/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground">
                {activeMenuItem?.label ?? "Cortex"}
              </span>
            </div>
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">
          {activeTab === "upload" && <UploadPage projectId={projectId} />}
          {activeTab === "chunks" && <ChunksPage projectId={projectId} />}
          {activeTab === "topics" && <TopicsPage projectId={projectId} />}
          {activeTab === "explore" && <ExplorePage projectId={projectId} />}
          {activeTab === "users" && <UserManagementPage />}
          {activeTab === "topic-detail" && topicIdFromUrl && (
            <TopicDetailPage projectId={projectId} topicId={topicIdFromUrl} />
          )}
        </main>
      </SidebarInset>
    </>
  );
}
