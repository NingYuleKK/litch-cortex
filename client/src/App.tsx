import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import ProjectList from "./pages/ProjectList";
import ProjectWorkspace from "./pages/ProjectWorkspace";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={ProjectList} />
      <Route path={"/project/:projectId"} component={ProjectWorkspace} />
      <Route path={"/project/:projectId/:tab"} component={ProjectWorkspace} />
      <Route path={"/project/:projectId/topics/:topicId"} component={ProjectWorkspace} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
