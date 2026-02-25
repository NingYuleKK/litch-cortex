import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  ChevronLeft, FolderOpen, Loader2,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { DashboardLayoutSkeleton } from "@/components/DashboardLayoutSkeleton";
import { getLoginUrl } from "@/const";

// Sub-pages
import UploadPage from "./Home";
import ChunksPage from "./Chunks";
import TopicsPage from "./Topics";
import TopicDetailPage from "./TopicDetail";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function ProjectWorkspace() {
  const params = useParams<{ projectId: string; tab?: string; topicId?: string }>();
  const projectId = parseInt(params.projectId || "0");
  const { loading, user } = useAuth();

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <Brain className="h-12 w-12 text-primary" />
          <h1 className="text-2xl font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Litch's Cortex
          </h1>
          <Button onClick={() => { window.location.href = getLoginUrl(); }} size="lg" className="w-full">
            登录
          </Button>
        </div>
      </div>
    );
  }

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
  const { user, logout } = useAuth();
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
    // Check if we're on a topic detail page: /project/:id/topics/:topicId
    if (location.match(/^\/project\/\d+\/topics\/\d+$/)) {
      return "topic-detail";
    }
    if (tab === "chunks") return "chunks";
    if (tab === "topics") return "topics";
    return "upload";
  }, [tab, location]);

  const menuItems = [
    { icon: Upload, label: "上传文档", key: "upload", path: `/project/${projectId}` },
    { icon: FileText, label: "分段预览", key: "chunks", path: `/project/${projectId}/chunks` },
    { icon: Tags, label: "话题列表", key: "topics", path: `/project/${projectId}/topics` },
  ];

  const activeMenuItem = menuItems.find(item => item.key === activeTab) || menuItems[0];

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
                  <Brain className="h-5 w-5 text-primary shrink-0" />
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
                  <FolderOpen className="h-4 w-4 text-primary shrink-0" />
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
                      <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary/20 text-primary">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-foreground">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
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
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
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
          {activeTab === "topic-detail" && topicIdFromUrl && (
            <TopicDetailPage projectId={projectId} topicId={topicIdFromUrl} />
          )}
        </main>
      </SidebarInset>
    </>
  );
}
