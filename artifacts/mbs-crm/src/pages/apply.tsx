import { useState, useRef, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import SignaturePad from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle2,
  Building2,
  Wrench,
  Upload,
  X,
  ChevronRight,
  ChevronLeft,
  Loader2,
  FileText,
} from "lucide-react";

const TOTAL_STEPS = 6;

const INDUSTRIES = [
  "Retail", "Restaurant / Food Service", "Construction", "Healthcare",
  "Transportation / Trucking", "Auto Repair", "Beauty / Salon",
  "Professional Services", "Manufacturing", "Real Estate",
  "Technology", "Wholesale / Distribution", "Other",
];

const TIME_IN_BUSINESS = [
  { label: "Less than 1 year", value: "0" },
  { label: "1 year", value: "12" },
  { label: "2 years", value: "24" },
  { label: "3 years", value: "36" },
  { label: "4+ years", value: "48" },
  { label: "10+ years", value: "120" },
];

const MONTHLY_REVENUE = [
  { label: "$10,000 – $25,000", value: "17500" },
  { label: "$25,000 – $50,000", value: "37500" },
  { label: "$50,000 – $100,000", value: "75000" },
  { label: "$100,000 – $250,000", value: "175000" },
  { label: "$250,000 – $500,000", value: "375000" },
  { label: "$500,000+", value: "500000" },
];

const REQUESTED_AMOUNTS = [
  { label: "$5,000 – $15,000", value: "10000" },
  { label: "$15,000 – $50,000", value: "32500" },
  { label: "$50,000 – $100,000", value: "75000" },
  { label: "$100,000 – $250,000", value: "175000" },
  { label: "$250,000 – $500,000", value: "375000" },
  { label: "$500,000+", value: "500000" },
];

// Mask SSN input so it shows dots for first 5 digits
/** Format partial SSN digits as user types (plain digits until complete). */
function formatSsnTyping(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

interface FormData {
  type: "working_capital" | "equipment" | "";
  businessName: string;
  dba: string;
  ein: string;
  businessAddress: string;
  businessCity: string;
  businessState: string;
  businessZip: string;
  industry: string;
  timeInBusinessMonths: string;
  monthlyRevenueStated: string;
  requestedAmount: string;
  useOfFunds: string;
  equipmentDescription: string;
  vendorName: string;
  vendorQuoteAmount: string;
  equipmentCondition: "new" | "used" | "";
  email: string;
  phone: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerSsn: string;
  ownerDob: string;
  ownerHomeAddress: string;
  ownerHomeCity: string;
  ownerHomeState: string;
  ownerHomeZip: string;
  ownershipPct: string;
  consentCreditPull: boolean;
  consentTerms: boolean;
}

const emptyForm = (): FormData => ({
  type: "",
  businessName: "", dba: "", ein: "",
  businessAddress: "", businessCity: "", businessState: "", businessZip: "",
  industry: "", timeInBusinessMonths: "", monthlyRevenueStated: "",
  requestedAmount: "", useOfFunds: "",
  equipmentDescription: "", vendorName: "", vendorQuoteAmount: "", equipmentCondition: "",
  email: "", phone: "",
  ownerFirstName: "", ownerLastName: "", ownerSsn: "", ownerDob: "",
  ownerHomeAddress: "", ownerHomeCity: "", ownerHomeState: "", ownerHomeZip: "",
  ownershipPct: "100",
  consentCreditPull: false, consentTerms: false,
});

// Dropzone for bank statements
function BankStatementDropzone({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const onDrop = useCallback((accepted: File[]) => {
    onChange([...files, ...accepted.filter((f) => f.type === "application/pdf")]);
  }, [files, onChange]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    multiple: true,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragActive ? "border-[#1F4E79] bg-blue-50" : "border-gray-300 hover:border-[#1F4E79] hover:bg-slate-50"
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="h-8 w-8 text-gray-400 mx-auto mb-3" />
        <p className="font-medium text-gray-700">
          {isDragActive ? "Drop PDFs here…" : "Drag & drop bank statement PDFs"}
        </p>
        <p className="text-sm text-gray-400 mt-1">or click to browse — PDF only, max 20 MB each</p>
      </div>
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-gray-700">
                <FileText className="h-4 w-4 text-[#1F4E79]" />
                {f.name}
                <span className="text-gray-400">({(f.size / 1024).toFixed(0)} KB)</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="text-gray-400 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-400">
        Minimum 3 months of bank statements required. More months = faster approval.
      </p>
    </div>
  );
}

// Progress bar
function ProgressBar({ step }: { step: number }) {
  const pct = Math.round((step / TOTAL_STEPS) * 100);
  return (
    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div
        className="h-full bg-[#1F4E79] transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MBSHeader() {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1F4E79] text-white flex-shrink-0">
        <Building2 className="h-5 w-5" />
      </div>
      <div>
        <p className="font-bold text-[#1F4E79] text-lg leading-tight">My Business Solutions</p>
        <p className="text-xs text-gray-400">Business Financing Application</p>
      </div>
    </div>
  );
}

export default function ApplyPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [ssnRaw, setSsnRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedLeadId, setConfirmedLeadId] = useState<number | null>(null);
  const sigPadRef = useRef<SignaturePad>(null);
  const [signatureMode, setSignatureMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState("");

  const set = (patch: Partial<FormData>) => setForm((f) => ({ ...f, ...patch }));

  const getSignatureData = (): string => {
    if (signatureMode === "draw") {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) return "";
      return sigPadRef.current.getTrimmedCanvas().toDataURL("image/png");
    }
    // Type mode: render name as canvas
    const canvas = document.createElement("canvas");
    canvas.width = 400; canvas.height = 80;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = "italic 32px Georgia, serif";
      ctx.fillStyle = "#1F4E79";
      ctx.fillText(typedName, 20, 55);
    }
    return canvas.toDataURL("image/png");
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (typeof v === "boolean") formData.append(k, String(v));
        else if (v) formData.append(k, v as string);
      });
      formData.append("ownerSsn", ssnRaw.replace(/\D/g, ""));
      const sig = getSignatureData();
      if (sig) formData.append("signatureData", sig);
      for (const file of bankFiles) {
        formData.append("bankStatements", file);
      }

      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/applications/submit`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.status === 409) {
        setSubmitError("An application with your email, phone, or EIN already exists. Please contact us directly.");
        return;
      }
      if (!res.ok) {
        setSubmitError(data.error || "Submission failed. Please try again.");
        return;
      }
      setConfirmedLeadId(data.leadId);
      setStep(6);
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvance = () => {
    switch (step) {
      case 1: return form.type !== "";
      case 2: return !!(form.businessName && form.email && form.phone && form.industry && form.timeInBusinessMonths && form.monthlyRevenueStated && form.requestedAmount);
      case 3: return !!(form.ownerFirstName && form.ownerLastName && ssnRaw.replace(/\D/g,"").length === 9);
      case 4: return bankFiles.length >= 3;
      case 5: return form.consentCreditPull && form.consentTerms && (
        signatureMode === "type" ? typedName.trim().length > 2 : (sigPadRef.current && !sigPadRef.current.isEmpty())
      );
      default: return true;
    }
  };

  // Step 6 — confirmation
  if (step === 6) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center px-4 py-12">
        <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 text-center space-y-5">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Application Submitted!</h1>
          <p className="text-gray-500 text-sm">
            Thank you, <strong>{form.ownerFirstName}</strong>! Your application for{" "}
            <strong>{form.businessName}</strong> has been received. A dedicated funding specialist will contact you within 1 business day.
          </p>
          {confirmedLeadId && (
            <div className="bg-slate-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-400">Reference Number</p>
              <p className="font-mono font-bold text-[#1F4E79] text-lg">MBS-{String(confirmedLeadId).padStart(5, "0")}</p>
            </div>
          )}
          <p className="text-xs text-gray-400">Questions? Call us at (800) 000-0000</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-[#1F4E79] px-6 py-5 text-white">
            <MBSHeader />
            <div className="mt-4 space-y-1">
              <div className="flex justify-between text-xs text-blue-200">
                <span>Step {step} of {TOTAL_STEPS - 1}</span>
                <span>{Math.round((step / (TOTAL_STEPS - 1)) * 100)}% complete</span>
              </div>
              <ProgressBar step={step} />
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-6 space-y-5">

            {/* ── Step 1: Product selection ── */}
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900">What type of financing are you looking for?</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => set({ type: "working_capital" })}
                    className={`rounded-xl border-2 p-5 text-left transition-all ${
                      form.type === "working_capital"
                        ? "border-[#1F4E79] bg-blue-50"
                        : "border-gray-200 hover:border-blue-200"
                    }`}
                  >
                    <Building2 className={`h-7 w-7 mb-3 ${form.type === "working_capital" ? "text-[#1F4E79]" : "text-gray-400"}`} />
                    <p className="font-semibold text-gray-900">Working Capital</p>
                    <p className="text-xs text-gray-400 mt-1">Merchant Cash Advance or term loan for operations, payroll, inventory, or growth.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => set({ type: "equipment" })}
                    className={`rounded-xl border-2 p-5 text-left transition-all ${
                      form.type === "equipment"
                        ? "border-[#1F4E79] bg-blue-50"
                        : "border-gray-200 hover:border-blue-200"
                    }`}
                  >
                    <Wrench className={`h-7 w-7 mb-3 ${form.type === "equipment" ? "text-[#1F4E79]" : "text-gray-400"}`} />
                    <p className="font-semibold text-gray-900">Equipment Financing</p>
                    <p className="text-xs text-gray-400 mt-1">Finance new or used equipment with low monthly payments and flexible terms.</p>
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Business info ── */}
            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900">Business Information</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2 space-y-1">
                    <Label className="text-xs">Legal Business Name *</Label>
                    <Input value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="ABC LLC" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">DBA (if different)</Label>
                    <Input value={form.dba} onChange={(e) => set({ dba: e.target.value })} placeholder="Trade name" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">EIN / Tax ID</Label>
                    <Input value={form.ein} onChange={(e) => set({ ein: e.target.value })} placeholder="XX-XXXXXXX" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email *</Label>
                    <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@business.com" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone *</Label>
                    <Input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(555) 000-0000" />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <Label className="text-xs">Business Address</Label>
                    <Input value={form.businessAddress} onChange={(e) => set({ businessAddress: e.target.value })} placeholder="123 Main St" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">City</Label>
                    <Input value={form.businessCity} onChange={(e) => set({ businessCity: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">State</Label>
                      <Input value={form.businessState} onChange={(e) => set({ businessState: e.target.value })} placeholder="FL" maxLength={2} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">ZIP</Label>
                      <Input value={form.businessZip} onChange={(e) => set({ businessZip: e.target.value })} placeholder="33101" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Industry *</Label>
                    <Select value={form.industry} onValueChange={(v) => set({ industry: v })}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>{INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Time in Business *</Label>
                    <Select value={form.timeInBusinessMonths} onValueChange={(v) => set({ timeInBusinessMonths: v })}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>{TIME_IN_BUSINESS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monthly Revenue *</Label>
                    <Select value={form.monthlyRevenueStated} onValueChange={(v) => set({ monthlyRevenueStated: v })}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>{MONTHLY_REVENUE.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Requested Amount *</Label>
                    <Select value={form.requestedAmount} onValueChange={(v) => set({ requestedAmount: v })}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>{REQUESTED_AMOUNTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <Label className="text-xs">Use of Funds</Label>
                    <Textarea rows={2} value={form.useOfFunds} onChange={(e) => set({ useOfFunds: e.target.value })} placeholder="Describe how you plan to use the funds…" />
                  </div>
                  {form.type === "equipment" && (
                    <>
                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-xs">Equipment Description *</Label>
                        <Input value={form.equipmentDescription} onChange={(e) => set({ equipmentDescription: e.target.value })} placeholder="e.g. 2024 Ford F-250 Work Truck" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Vendor / Dealer Name</Label>
                        <Input value={form.vendorName} onChange={(e) => set({ vendorName: e.target.value })} placeholder="Dealer name" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Quote Amount ($)</Label>
                        <Input type="number" value={form.vendorQuoteAmount} onChange={(e) => set({ vendorQuoteAmount: e.target.value })} placeholder="50000" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Condition</Label>
                        <Select value={form.equipmentCondition} onValueChange={(v) => set({ equipmentCondition: v as "new" | "used" })}>
                          <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="used">Used</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 3: Owner info ── */}
            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900">Owner Information</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">First Name *</Label>
                    <Input value={form.ownerFirstName} onChange={(e) => set({ ownerFirstName: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Last Name *</Label>
                    <Input value={form.ownerLastName} onChange={(e) => set({ ownerLastName: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Social Security Number *</Label>
                    {ssnRaw.length < 9 ? (
                      <Input
                        value={formatSsnTyping(ssnRaw)}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                          setSsnRaw(digits);
                        }}
                        placeholder="XXX-XX-XXXX"
                        inputMode="numeric"
                        autoComplete="off"
                      />
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          value={`•••-••-${ssnRaw.slice(5)}`}
                          readOnly
                          className="font-mono tracking-widest bg-slate-50"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSsnRaw("")}
                          className="flex-shrink-0 text-xs"
                        >
                          Clear
                        </Button>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400">Encrypted at rest — never stored as plain text</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Date of Birth</Label>
                    <Input type="date" value={form.ownerDob} onChange={(e) => set({ ownerDob: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <Label className="text-xs">Home Address</Label>
                    <Input value={form.ownerHomeAddress} onChange={(e) => set({ ownerHomeAddress: e.target.value })} placeholder="123 Oak St" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">City</Label>
                    <Input value={form.ownerHomeCity} onChange={(e) => set({ ownerHomeCity: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">State</Label>
                      <Input value={form.ownerHomeState} onChange={(e) => set({ ownerHomeState: e.target.value })} placeholder="FL" maxLength={2} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">ZIP</Label>
                      <Input value={form.ownerHomeZip} onChange={(e) => set({ ownerHomeZip: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ownership %</Label>
                    <Input type="number" min="1" max="100" value={form.ownershipPct} onChange={(e) => set({ ownershipPct: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 4: Bank statements ── */}
            {step === 4 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Bank Statement Upload</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Please upload your 3 most recent months of business bank statements (PDF format).
                    Our AI will extract your financial data automatically.
                  </p>
                </div>
                <BankStatementDropzone files={bankFiles} onChange={setBankFiles} />
                {bankFiles.length < 3 && bankFiles.length > 0 && (
                  <p className="text-xs text-amber-600">Please add at least {3 - bankFiles.length} more statement(s).</p>
                )}
              </div>
            )}

            {/* ── Step 5: Review & sign ── */}
            {step === 5 && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-gray-900">Review & Sign</h2>

                {/* Summary */}
                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                  <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-3">Application Summary</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <span className="text-gray-500">Type</span><span className="font-medium capitalize">{form.type.replace("_", " ")}</span>
                    <span className="text-gray-500">Business</span><span className="font-medium">{form.businessName}</span>
                    <span className="text-gray-500">Owner</span><span className="font-medium">{form.ownerFirstName} {form.ownerLastName}</span>
                    <span className="text-gray-500">SSN</span><span className="font-medium">***-**-{ssnRaw.slice(-4) || "****"}</span>
                    <span className="text-gray-500">Email</span><span className="font-medium">{form.email}</span>
                    <span className="text-gray-500">Phone</span><span className="font-medium">{form.phone}</span>
                    <span className="text-gray-500">Revenue/mo</span><span className="font-medium">${Number(form.monthlyRevenueStated).toLocaleString()}</span>
                    <span className="text-gray-500">Requested</span><span className="font-medium">${Number(form.requestedAmount).toLocaleString()}</span>
                    <span className="text-gray-500">Bank Stmts</span><span className="font-medium">{bankFiles.length} file(s)</span>
                  </div>
                </div>

                {/* Consent checkboxes */}
                <div className="space-y-3">
                  <div className="flex gap-3 items-start">
                    <Checkbox
                      id="consent_credit"
                      checked={form.consentCreditPull}
                      onCheckedChange={(v) => set({ consentCreditPull: !!v })}
                      className="mt-0.5"
                    />
                    <Label htmlFor="consent_credit" className="text-xs text-gray-600 leading-relaxed cursor-pointer">
                      I authorize My Business Solutions (MBS) and its lending partners to obtain my business and personal credit report for the purpose of evaluating my financing application.
                    </Label>
                  </div>
                  <div className="flex gap-3 items-start">
                    <Checkbox
                      id="consent_terms"
                      checked={form.consentTerms}
                      onCheckedChange={(v) => set({ consentTerms: !!v })}
                      className="mt-0.5"
                    />
                    <Label htmlFor="consent_terms" className="text-xs text-gray-600 leading-relaxed cursor-pointer">
                      I confirm that all information provided is accurate and complete. I agree to MBS&apos;s Terms of Service and Privacy Policy.
                    </Label>
                  </div>
                </div>

                {/* Signature */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold text-gray-700">Applicant Signature</p>
                    <div className="flex rounded-lg border overflow-hidden text-xs">
                      <button
                        type="button"
                        onClick={() => setSignatureMode("draw")}
                        className={`px-3 py-1.5 ${signatureMode === "draw" ? "bg-[#1F4E79] text-white" : "bg-white text-gray-600"}`}
                      >Draw</button>
                      <button
                        type="button"
                        onClick={() => setSignatureMode("type")}
                        className={`px-3 py-1.5 ${signatureMode === "type" ? "bg-[#1F4E79] text-white" : "bg-white text-gray-600"}`}
                      >Type</button>
                    </div>
                  </div>
                  {signatureMode === "draw" ? (
                    <div className="border rounded-xl overflow-hidden bg-slate-50">
                      <SignaturePad
                        ref={sigPadRef}
                        canvasProps={{ className: "w-full", style: { height: 120 } }}
                        penColor="#1F4E79"
                      />
                      <div className="flex justify-end px-2 pb-1">
                        <button
                          type="button"
                          onClick={() => sigPadRef.current?.clear()}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >Clear</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        value={typedName}
                        onChange={(e) => setTypedName(e.target.value)}
                        placeholder="Type your full legal name"
                        className="text-lg italic font-serif text-[#1F4E79]"
                      />
                      <p className="text-xs text-gray-400">Your typed name serves as your electronic signature.</p>
                    </div>
                  )}
                </div>

                {submitError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    {submitError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="px-6 pb-6 flex justify-between gap-3">
            {step > 1 ? (
              <Button variant="outline" onClick={() => setStep(step - 1)} className="flex items-center gap-1.5">
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
            ) : <div />}

            {step < 5 ? (
              <Button
                className="bg-[#1F4E79] hover:bg-[#163a5f] text-white flex items-center gap-1.5"
                onClick={() => setStep(step + 1)}
                disabled={!canAdvance()}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                className="bg-[#1F4E79] hover:bg-[#163a5f] text-white flex items-center gap-1.5"
                onClick={handleSubmit}
                disabled={!canAdvance() || submitting}
              >
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : "Submit Application"}
              </Button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          256-bit encrypted · Your data is secure · My Business Solutions LLC
        </p>
      </div>
    </div>
  );
}
