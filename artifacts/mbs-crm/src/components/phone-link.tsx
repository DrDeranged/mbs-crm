import { useContext, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Mail, Phone } from "lucide-react";
import { SoftphoneContext } from "./softphone-context";
import { cn } from "@/lib/utils";
import { emailActionTarget, isMobileWeb, phoneActionForDevice } from "@/lib/recordContact";

interface PhoneLinkProps {
  phone: string;
  leadId?: number;
  showIcon?: boolean;
  className?: string;
  children?: ReactNode;
}

interface EmailLinkProps {
  email: string;
  leadId?: number;
  showIcon?: boolean;
  className?: string;
}

/** Desktop clicks use the registered CRM device; all fallback/mobile clicks use tel:. */
export function PhoneLink({ phone, leadId, showIcon = true, className, children }: PhoneLinkProps) {
  const { dial, softphoneAvailable } = useContext(SoftphoneContext);
  const dialHref = `tel:${phone.replace(/[^\d+]/g, "")}`;

  return (
    <a
      href={dialHref}
      draggable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (phoneActionForDevice(
          typeof window !== "undefined" && isMobileWeb({
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
            viewportWidth: window.innerWidth,
            pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
          }),
          softphoneAvailable,
        ) === "softphone") {
          event.preventDefault();
          dial(phone, { autoCall: true, leadId });
        }
      }}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline transition-colors",
        className
      )}
      title={`Call ${phone}`}
      aria-label={`Call ${phone}`}
    >
      {children ?? <>
        {showIcon && <Phone className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" aria-hidden="true" />}
        <span className="font-mono text-sm">{phone}</span>
      </>}
    </a>
  );
}

/** Opens the CRM email composer for authorized lead records, with a mailto fallback. */
export function EmailLink({ email, leadId, showIcon = true, className }: EmailLinkProps) {
  const [, setLocation] = useLocation();
  const { openEmailComposer, composerAvailable } = useContext(SoftphoneContext);
  const target = emailActionTarget(email, leadId, composerAvailable);

  return (
    <a
      href={target.href}
      draggable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (target.kind !== "composer" || !leadId) return;
        event.preventDefault();
        openEmailComposer(leadId);
        setLocation(target.href);
      }}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline transition-colors",
        className
      )}
      title={`Email ${email}`}
      aria-label={`Email ${email}`}
    >
      {showIcon && <Mail className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" aria-hidden="true" />}
      <span className="break-all">{email}</span>
    </a>
  );
}