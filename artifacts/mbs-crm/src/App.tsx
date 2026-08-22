import { lazy, Suspense, useEffect, useRef } from "react";
import { ClerkProvider, SignIn, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app-shell";
import { BrandLogo } from "@/components/brand-logo";
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
const SystemHealth = lazy(() => import("@/pages/system-health"));
const Governance = lazy(() => import("@/pages/governance"));
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
    colorPrimary: "#17A567",
    colorForeground: "#ffffff",
    colorMutedForeground: "rgba(255,255,255,.62)",
    colorDanger: "#dc2626",
    colorBackground: "rgba(255,255,255,.08)",
    colorInput: "#ffffff",
    colorInputForeground: "#0f172a",
    colorNeutral: "rgba(255,255,255,.2)",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "0.875rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white/10 border border-white/15 backdrop-blur-xl rounded-[14px] w-[440px] max-w-full overflow-hidden shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-bold",
    headerSubtitle: "text-white/60",
    socialButtonsBlockButtonText: {
      style: {
        color: "#ffffff",
        fontWeight: "500",
        fontSize: "0.875rem",
      },
    },
    formFieldLabel: "text-white/85",
    footerActionLink: "text-[#65D5A2] hover:text-white",
    footerActionText: "text-white/60",
    dividerText: "text-white/45",
    identityPreviewEditButton: "text-[#65D5A2]",
    formFieldSuccessText: "text-[#65D5A2]",
    alertText: "text-white",
    logoBox: "mb-2",
    logoImage: "h-10",
    socialButtonsBlockButton: {
      style: {
        border: "1px solid rgba(255,255,255,.2)",
        backgroundColor: "rgba(255,255,255,.08)",
        color: "#ffffff",
        fontWeight: "500",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.12)",
        borderRadius: "9999px",
      },
    },
    formButtonPrimary: "bg-gradient-to-b from-[#1DB674] to-[#149258] hover:shadow-[0_8px_24px_rgba(23,165,103,.35)] text-white rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,.18)]",
    formFieldInput: "border-white/20 bg-white/95 text-[#0E2A47]",
    footerAction: "bg-white/8",
    dividerLine: "bg-white/15",
    alert: "bg-red-500/15 border-red-300/30",
    otpCodeFieldInput: "border-white/20 bg-white text-[#0E2A47]",
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
    <div className="flex min-h-screen w-full bg-[#0E2A47]">
      {/* Left brand panel — navy, desktop only */}
      <div
        className="hidden md:flex md:w-[45%] flex-col items-center justify-center gap-8 px-12 relative overflow-hidden"
        style={{ background: "radial-gradient(circle at 18% 20%, rgba(29,182,116,.22), transparent 30%), radial-gradient(circle at 82% 78%, rgba(31,78,121,.9), transparent 42%), #0E2A47" }}
      >
        {/* Decorative circles */}
        <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-1/3 -right-4 h-16 w-16 rounded-full bg-white/5 pointer-events-none" />
        <div className="max-w-xs text-center space-y-5 relative z-10">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-white tracking-tight leading-tight">
              My Business Solutions
            </h1>
            <p className="text-lg text-white/65 font-light">
              Business financing, simplified.
            </p>
          </div>
          <div className="w-12 h-0.5 bg-[#17A567] mx-auto rounded-full" />
          <p className="text-sm text-white/65 leading-relaxed">
            Fast, flexible funding for businesses ready to grow. Our dedicated specialists guide you every step of the way.
          </p>
        </div>
      </div>

      {/* Right sign-in panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[#0E2A47] px-6 py-12" style={{ backgroundImage: "radial-gradient(circle at 75% 20%, rgba(29,182,116,.12), transparent 28%), radial-gradient(circle at 30% 90%, rgba(31,78,121,.85), transparent 40%)" }}>
        <div className="w-full max-w-[440px] space-y-7">
          <div className="flex flex-col items-center gap-3">
            <BrandLogo
              variant="chip"
              className="px-5 py-3 shadow-[0_10px_30px_rgba(0,0,0,.2)]"
              imageClassName="h-8"
            />
            <p className="text-sm text-white/60 md:hidden">Business financing, simplified.</p>
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
            <Route path="/system-health">
              <ProtectedRoute component={SystemHealth} />
            </Route>
            <Route path="/governance">
              <ProtectedRoute component={Governance} />
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
          <BrandLogo variant="raw" className="mb-6" imageClassName="h-8" />
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
