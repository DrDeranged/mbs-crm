import { SignIn } from "@clerk/react";
import mbsLogo from "@/assets/MBS-Logo-Header-Logo.png";

export default function Login() {
  return (
    <div className="flex min-h-screen w-full">
      {/* Left brand panel — navy, visible on md+ */}
      <div
        className="hidden md:flex md:w-[45%] flex-col items-center justify-center gap-8 px-12"
        style={{ backgroundColor: "#1F4E79" }}
      >
        <div className="max-w-xs text-center space-y-6">
          <div className="space-y-1">
            <h1 className="text-4xl font-bold text-white tracking-tight leading-tight">
              My Business Solutions
            </h1>
            <p className="text-lg text-blue-200 font-light">
              Business financing, simplified.
            </p>
          </div>
          <div className="w-12 h-0.5 bg-blue-400/50 mx-auto rounded-full" />
          <p className="text-sm text-blue-200/80 leading-relaxed">
            Fast, flexible funding for businesses that are ready to grow. Our dedicated specialists guide you every step of the way.
          </p>
        </div>
        {/* Decorative circles */}
        <div className="absolute bottom-12 left-8 h-32 w-32 rounded-full bg-white/5 hidden md:block" />
        <div className="absolute top-8 left-4 h-16 w-16 rounded-full bg-white/5 hidden md:block" />
      </div>

      {/* Right sign-in panel — light background */}
      <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-[400px] space-y-8">
          {/* Logo — on the light side so black wordmark is visible */}
          <div className="flex flex-col items-center gap-3">
            <img
              src={mbsLogo}
              alt="My Business Solutions"
              className="h-12 w-auto object-contain"
              style={{ imageRendering: "crisp-edges" }}
            />
            {/* Mobile-only tagline (not shown on desktop since panel is hidden) */}
            <p className="text-sm text-slate-500 md:hidden">Business financing, simplified.</p>
          </div>

          <SignIn
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "shadow-lg border border-slate-100 rounded-2xl bg-white w-full",
                headerTitle: "text-xl font-bold tracking-tight text-slate-900",
                headerSubtitle: "text-sm text-slate-500",
                formButtonPrimary:
                  "bg-[#1F4E79] hover:bg-[#163a5f] text-white font-semibold rounded-xl shadow-sm transition-colors",
                formFieldInput:
                  "rounded-xl border-slate-200 focus:border-[#1F4E79] focus:ring-[#1F4E79]/20",
                footerActionLink: "text-[#1F4E79] hover:text-[#163a5f] font-medium",
                identityPreviewEditButton: "text-[#1F4E79]",
                socialButtonsBlockButton:
                  "border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 font-medium",
                dividerLine: "bg-slate-100",
                dividerText: "text-slate-400 text-xs",
              },
            }}
            routing="path"
            path="/login"
            forceRedirectUrl="/dashboard"
            signUpUrl={undefined}
          />
        </div>
      </div>
    </div>
  );
}
