import { lazy, Suspense, useEffect, useRef } from "react";
import { ClerkProvider, SignIn, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app-shell";
import { SoftphoneWidget } from "@/components/softphone-widget";
import { SoftphoneProvider } from "@/components/softphone-context";

// Lazy-loaded pages — each becomes a separate chunk, downloaded only when first visited
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Leads = lazy(() => import("@/pages/leads"));
const LeadDetail = lazy(() => import("@/pages/lead-detail"));
const NewLead = lazy(() => import("@/pages/new-lead"));
const Settings = lazy(() => import("@/pages/settings"));
const EmailTemplates = lazy(() => import("@/pages/email-templates"));
const DripSequences = lazy(() => import("@/pages/drip-sequences"));
const LenderManagement = lazy(() => import("@/pages/lender-management"));
const FlyerTemplates = lazy(() => import("@/pages/flyer-templates"));
const ApplyPage = lazy(() => import("@/pages/apply"));
const ApplicationStatus = lazy(() => import("@/pages/application-status"));
const CreditCompliance = lazy(() => import("@/pages/credit-compliance"));
const WorkflowRules = lazy(() => import("@/pages/workflow-rules"));
const NotFound = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  cssLayerName: "clerk" as const,
  variables: {
    colorPrimary: "#1F4E79",
    colorForeground: "#0f172a",
    colorMutedForeground: "#64748b",
    colorDanger: "#dc2626",
    colorBackground: "#f8fafc",
    colorInput: "#ffffff",
    colorInputForeground: "#0f172a",
    colorNeutral: "#e2e8f0",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-slate-900 font-bold",
    headerSubtitle: "text-slate-500",
    socialButtonsBlockButtonText: "text-slate-700",
    formFieldLabel: "text-slate-700",
    footerActionLink: "text-[#1F4E79] hover:text-[#163a5f]",
    footerActionText: "text-slate-500",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-[#1F4E79]",
    formFieldSuccessText: "text-green-600",
    alertText: "text-slate-700",
    logoBox: "mb-2",
    logoImage: "h-10",
    socialButtonsBlockButton: "border border-slate-200 hover:bg-slate-50",
    formButtonPrimary: "bg-[#1F4E79] hover:bg-[#163a5f] text-white",
    formFieldInput: "border-slate-200 text-slate-900",
    footerAction: "bg-slate-50",
    dividerLine: "bg-slate-200",
    alert: "bg-red-50 border-red-200",
    otpCodeFieldInput: "border-slate-200",
    formFieldRow: "",
    main: "",
  },
};

function PageLoader() {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[60vh]">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full flex flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F4E79] text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          </div>
          <span className="text-2xl font-bold text-slate-900">MBS CRM</span>
        </div>
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          appearance={clerkAppearance}
          signUpUrl={undefined}
          forceRedirectUrl={`${basePath}/dashboard`}
        />
      </div>
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <SoftphoneProvider>
          <AppShell>
            <Suspense fallback={<PageLoader />}>
              <Component />
            </Suspense>
          </AppShell>
          <SoftphoneWidget />
        </SoftphoneProvider>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }: { user?: { id: string } | null }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AppRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/dashboard">
              <ProtectedRoute component={Dashboard} />
            </Route>
            <Route path="/leads/new">
              <ProtectedRoute component={NewLead} />
            </Route>
            <Route path="/leads/:id">
              <ProtectedRoute component={LeadDetail} />
            </Route>
            <Route path="/leads">
              <ProtectedRoute component={Leads} />
            </Route>
            <Route path="/settings">
              <ProtectedRoute component={Settings} />
            </Route>
            <Route path="/email/templates">
              <ProtectedRoute component={EmailTemplates} />
            </Route>
            <Route path="/drip/sequences">
              <ProtectedRoute component={DripSequences} />
            </Route>
            <Route path="/lenders">
              <ProtectedRoute component={LenderManagement} />
            </Route>
            <Route path="/flyer-templates">
              <ProtectedRoute component={FlyerTemplates} />
            </Route>
            <Route path="/apply" component={ApplyPage} />
            <Route path="/apply/status" component={ApplicationStatus} />
            <Route path="/credit/compliance">
              <ProtectedRoute component={CreditCompliance} />
            </Route>
            <Route path="/workflow-rules">
              <ProtectedRoute component={WorkflowRules} />
            </Route>
            <Route>
              <Suspense fallback={<PageLoader />}>
                <NotFound />
              </Suspense>
            </Route>
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  if (!clerkPubKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-center">
        <div className="rounded-lg border bg-white p-8 shadow-sm">
          <h1 className="mb-2 text-xl font-bold text-red-600">Missing Clerk Configuration</h1>
          <p className="text-gray-600">Please set the VITE_CLERK_PUBLISHABLE_KEY environment variable.</p>
        </div>
      </div>
    );
  }

  return (
    <WouterRouter base={basePath}>
      <AppRoutes />
    </WouterRouter>
  );
}

export default App;
