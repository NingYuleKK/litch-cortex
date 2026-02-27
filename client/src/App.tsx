import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { CortexAuthProvider, useCortexAuth } from "./hooks/useCortexAuth";
import Login from "./pages/Login";
import ProjectList from "./pages/ProjectList";
import ProjectWorkspace from "./pages/ProjectWorkspace";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCortexAuth();

  if (loading) return null;
  if (!user) return <Redirect to="/login" />;
  return <>{children}</>;
}

function LoginGuard() {
  const { user, loading } = useCortexAuth();

  if (loading) return null;
  if (user) return <Redirect to="/" />;
  return <Login />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginGuard} />
      <Route path="/">
        <AuthGuard>
          <ProjectList />
        </AuthGuard>
      </Route>
      <Route path="/project/:projectId">
        <AuthGuard>
          <ProjectWorkspace />
        </AuthGuard>
      </Route>
      <Route path="/project/:projectId/:tab">
        <AuthGuard>
          <ProjectWorkspace />
        </AuthGuard>
      </Route>
      <Route path="/project/:projectId/topics/:topicId">
        <AuthGuard>
          <ProjectWorkspace />
        </AuthGuard>
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <CortexAuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </CortexAuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
