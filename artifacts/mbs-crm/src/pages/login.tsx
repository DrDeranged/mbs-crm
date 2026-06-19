import { SignIn } from "@clerk/react";

export default function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <SignIn
          appearance={{
            elements: {
              card: "shadow-xl border border-gray-100 rounded-xl",
              headerTitle: "text-2xl font-bold tracking-tight text-gray-900",
              headerSubtitle: "text-sm text-gray-500",
              primaryButton: "bg-blue-600 hover:bg-blue-700",
            },
          }}
          routing="path"
          path="/login"
          forceRedirectUrl="/dashboard"
          signUpUrl={undefined}
        />
      </div>
    </div>
  );
}
