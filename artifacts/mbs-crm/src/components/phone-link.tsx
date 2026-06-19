import { useContext } from "react";
import { Phone } from "lucide-react";
import { SoftphoneContext } from "./softphone-context";
import { cn } from "@/lib/utils";

interface PhoneLinkProps {
  phone: string;
  showIcon?: boolean;
  className?: string;
}

/**
 * Global click-to-call component.
 * Clicking opens the softphone and auto-dials the number.
 * Use wherever a phone number should be displayed in the CRM.
 */
export function PhoneLink({ phone, showIcon = true, className }: PhoneLinkProps) {
  const { dial } = useContext(SoftphoneContext);

  return (
    <button
      type="button"
      onClick={() => dial(phone, { autoCall: true })}
      className={cn(
        "inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline transition-colors",
        className
      )}
      title={`Call ${phone}`}
    >
      {showIcon && <Phone className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
      <span className="font-mono text-sm">{phone}</span>
    </button>
  );
}
