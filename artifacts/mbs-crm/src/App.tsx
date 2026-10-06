import { lazy, Suspense, useEffect, useRef } from "react";
import { ClerkProvider, SignIn, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app-shell";
import { PwaHandler } from "@/hooks/use-pwa";
import { BrandLogo } from "@/components/brand-logo";
import { SoftphoneWidget } from "@/components/softphone-widget";
import { SoftphoneProvider } from "@/components/softphone-context";
import { getGetMeQueryKey, useGetMe, UserRole } from "@workspace/api-client-react";
import { QueryErrorState } from "@/components/query-error-state";
import { AppearanceProvider } from "@/components/appearance-provider";
import { DashboardSkeleton, LeadDetailSkeleton, PipelineSkeleton, DocumentsSkeleton, CampaignSkeleton, RowsSkeleton } from "@/components/page-skeletons";

// Lazy-loaded pages — each becomes a separate chunk, downloaded only when first visited
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Leads = lazy(() => import("@/pages/leads"));
const Deals = lazy(() => import("@/pages/deals"));
const NewDeal = lazy(() => import("@/pages/new-deal"));
const DealDetail = lazy(() => import("@/pages/deal-detail"));
const LeadDetail = lazy(() => import("@/pages/lead-detail"));
const NewLead = lazy(() => import("@/pages/new-lead"));
const Settings = lazy(() => import("@/pages/settings"));
const RateConverter = lazy(() => import("@/pages/rate-converter"));
const RatePoints = lazy(() => import("@/pages/rate-points"));
const EmailTemplates = lazy(() => import("@/pages/email-templates"));
const DripSequences = lazy(() => import("@/pages/drip-sequences"));
const LenderManagement = lazy(() => import("@/pages/lender-management"));
const FlyerTemplates = lazy(() => import("@/pages/flyer-templates"));
const Documents = lazy(() => import("@/pages/documents"));
const Campaigns = lazy(() => import("@/pages/campaigns"));
const CampaignDetail = lazy(() => import("@/pages/campaign-detail"));
const FinancingCampaignRedirect = lazy(() => import("@/pages/financing-campaign-redirect"));
const ApplyPage = lazy(() => import("@/pages/apply"));
const RepChooser = lazy(() => import("@/pages/rep-chooser"));
const ApplicationStatus = lazy(() => import("@/pages/application-status"));
const CreditCompliance = lazy(() => import("@/pages/credit-compliance"));
const WorkflowRules = lazy(() => import("@/pages/workflow-rules"));
const SystemHealth = lazy(() => import("@/pages/system-health"));
const Governance = lazy(() => import("@/pages/governance"));
const UsfaIntake = lazy(() => import("@/pages/admin-usfa-intake"));
const RepQuickstart = lazy(() => import("@/pages/rep-quickstart"));
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
    colorPrimary: "hsl(var(--primary))",
    colorForeground: "hsl(var(--foreground))",
    colorMutedForeground: "hsl(var(--muted-foreground))",
    colorDanger: "hsl(var(--destructive))",
    colorBackground: "hsl(var(--card))",
    colorInput: "hsl(var(--card))",
    colorInputForeground: "hsl(var(--foreground))",
    colorNeutral: "hsl(var(--foreground))",
    fontFamily: "var(--app-font-sans)",
    borderRadius: "var(--radius)",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card border border-border rounded-xl w-[440px] max-w-full overflow-hidden shadow-none",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-bold",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: {
      style: {
        color: "hsl(var(--foreground))",
        fontWeight: "500",
        fontSize: "0.875rem",
      },
    },
    formFieldLabel: "text-foreground",
    footerActionLink: "text-info hover:underline",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-info",
    formFieldSuccessText: "text-success",
    alertText: "text-danger",
    socialButtonsBlockButton: {
      style: {
        border: "1px solid hsl(var(--border))",
        backgroundColor: "hsl(var(--card))",
        color: "hsl(var(--foreground))",
        fontWeight: "500",
        boxShadow: "none",
        borderRadius: "9999px",
      },
    },
    formButtonPrimary: "bg-primary text-primary-foreground rounded-full shadow-none",
    formFieldInput: "border-input bg-card text-foreground",
    footerAction: "bg-muted",
    dividerLine: "bg-border",
    alert: "bg-danger-bg border-danger/30",
    otpCodeFieldInput: "border-input bg-card text-foreground",
    formFieldRow: "",
    main: "",
  },
};

function PageLoader() {
  const [path] = useLocation();
  if (path === "/dashboard") return <DashboardSkeleton />;
  if (/^\/leads\/\d+/.test(path)) return <LeadDetailSkeleton />;
  if (path === "/leads" || path === "/leads/stale") return <div className="p-6" role="status" aria-label="Loading leads"><RowsSkeleton rows={5} /></div>;
  if (path === "/deals") return <PipelineSkeleton />;
  if (path === "/documents") return <div className="p-6"><DocumentsSkeleton /></div>;
  if (path === "/campaigns") return <div className="p-6"><CampaignSkeleton /></div>;
  return (
    <div className="flex flex-1 items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-4">
        <BrandLogo />
        <div role="status" aria-label="Loading page" className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    </div>
  );
}

function PendingApprovalGate() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-solid p-8 text-center">
        <BrandLogo
          variant="reverse"
          className="mx-auto mb-6 w-[160px]"
          imageClassName="h-auto w-[160px]"
        />
        <p className="text-lg font-semibold text-solid-foreground">
          Your account is awaiting approval — contact your administrator
        </p>
      </div>
    </main>
  );
}

type ProtectedPageProps = {
  component: React.ComponentType;
  allowedRoles?: string[];
};

function ApprovedUserRoute({ component: Component, allowedRoles }: ProtectedPageProps) {
  const { data: me, isLoading, isError, error, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
    },
  });

  if (isLoading) {
    return <PageLoader />;
  }

  if (isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-xl">
          <QueryErrorState
            label="Your account"
            error={error}
            onRetry={() => { void refetch(); }}
            testId="status-current-user-error"
          />
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-xl">
          <QueryErrorState
            label="Your account"
            error={undefined}
            onRetry={() => { void refetch(); }}
            testId="status-current-user-unavailable"
          />
        </div>
      </main>
    );
  }

  if (me.role === UserRole.pending) {
    return <PendingApprovalGate />;
  }

  return (
    <SoftphoneProvider>
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          {allowedRoles && !allowedRoles.includes(me.role) ? (
            <section className="p-6">
              <h1 className="text-xl font-semibold">Manager Access Required</h1>
              <p className="mt-2 text-muted-foreground">Campaigns are available to managers and admins.</p>
            </section>
          ) : <Component />}
        </Suspense>
      </AppShell>
      <SoftphoneWidget />
    </SoftphoneProvider>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Left brand panel — navy, desktop only */}
      <div
        className="hidden md:flex md:w-[45%] flex-col items-center justify-center gap-8 px-12 relative overflow-hidden bg-solid"
      >
        {/* Decorative circles */}
        <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-1/3 -right-4 h-16 w-16 rounded-full bg-white/5 pointer-events-none" />
        <div className="max-w-xs text-center space-y-5 relative z-[var(--z-hero-content)]">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-white tracking-tight leading-tight">
              My Business Solutions
            </h1>
            <p className="text-lg text-white/65 font-light">
              Business financing, simplified.
            </p>
          </div>
          <div className="w-12 h-0.5 bg-primary mx-auto rounded-full" />
          <p className="text-sm text-white/65 leading-relaxed">
            Fast, flexible funding for businesses ready to grow. Our dedicated specialists guide you every step of the way.
          </p>
        </div>
      </div>

      {/* Right sign-in panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-solid px-6 py-12">
        <div className="w-full max-w-[440px] space-y-7">
          <div className="flex flex-col items-center gap-3">
            <BrandLogo
              variant="reverse"
              className="w-[160px]"
              imageClassName="h-auto w-[160px]"
            />
            <p className="text-sm text-solid-foreground/70 md:hidden">Business financing, simplified.</p>
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
    </div>
  );
}

function ProtectedRoute({ component: Component, allowedRoles }: ProtectedPageProps) {
  return (
    <>
      <Show when="signed-in">
        <ApprovedUserRoute component={Component} allowedRoles={allowedRoles} />
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
      <AppearanceProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <PwaHandler />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/login">
              <Redirect to="/sign-in" />
            </Route>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/dashboard">
              <ProtectedRoute component={Dashboard} />
            </Route>
            <Route path="/leads/new">
              <ProtectedRoute component={NewLead} />
            </Route>
            <Route path="/leads/stale">
              <ProtectedRoute component={Leads} />
            </Route>
            <Route path="/leads/:id">
              <ProtectedRoute component={LeadDetail} />
            </Route>
            <Route path="/leads">
              <ProtectedRoute component={Leads} />
            </Route>
            <Route path="/deals/new">
              <ProtectedRoute component={NewDeal} />
            </Route>
            <Route path="/deals/rate-converter">
              <ProtectedRoute component={RateConverter} />
            </Route>
            <Route path="/deals/rate-points">
              <ProtectedRoute component={RatePoints} />
            </Route>
            <Route path="/deals/:id">
              <ProtectedRoute component={DealDetail} />
            </Route>
            <Route path="/deals">
              <ProtectedRoute component={Deals} />
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
            <Route path="/documents">
              <ProtectedRoute component={Documents} />
            </Route>
            <Route path="/campaigns/financing-draft">
              <ProtectedRoute component={FinancingCampaignRedirect} />
            </Route>
            <Route path="/campaigns/:id">
              <ProtectedRoute component={CampaignDetail} allowedRoles={["manager", "admin"]} />
            </Route>
            <Route path="/campaigns">
              <ProtectedRoute component={Campaigns} allowedRoles={["manager", "admin"]} />
            </Route>
            <Route path="/apply" component={ApplyPage} />
            <Route path="/r/:slug" component={RepChooser} />
            <Route path="/apply/status" component={ApplicationStatus} />
            <Route path="/credit/compliance">
              <ProtectedRoute component={CreditCompliance} />
            </Route>
            <Route path="/workflow-rules">
              <ProtectedRoute component={WorkflowRules} />
            </Route>
            <Route path="/system-health">
              <ProtectedRoute component={SystemHealth} />
            </Route>
            <Route path="/governance">
              <ProtectedRoute component={Governance} />
            </Route>
            <Route path="/admin/usfa-intake">
              <ProtectedRoute component={UsfaIntake} />
            </Route>
            <Route path="/help/rep-quickstart">
              <ProtectedRoute component={RepQuickstart} />
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
      </AppearanceProvider>
    </ClerkProvider>
  );
}

function App() {
  if (!clerkPubKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-center">
        <div className="rounded-lg border bg-card p-8">
          <BrandLogo className="mb-6" imageClassName="h-8 w-auto" />
          <h1 className="mb-2 text-xl font-bold text-danger">Missing Clerk Configuration</h1>
          <p className="text-muted-foreground">Please set the VITE_CLERK_PUBLISHABLE_KEY environment variable.</p>
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
