import { useContext, useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { getUserDisplayName } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownLeft, ArrowUpRight, Mail, MailCheck, MailOpen, MessageSquare, Phone, PhoneCall, Send, Sparkles, Zap, Loader2 } from "lucide-react";
import { AiDraftRequestChannel, getGetLeadDripEnrollmentQueryKey, getListCommunicationsQueryKey, getListLeadActivityQueryKey, getListLeadEmailsQueryKey, useEnrollLeadInDrip, useGenerateAiDraft, useGetLeadDripEnrollment, useListCommunications, useListDripSequences, useListEmailTemplates, useListLeadEmails, usePreviewEmailTemplate, useSendEmail, useSendSms, useUnenrollLeadFromDrip } from "@workspace/api-client-react";
import { SoftphoneContext } from "@/components/softphone-context";
import { useLeadDetail } from "./context";
// Email status badge helper
function EmailStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "bg-slate-100 text-slate-600",
    sent: "bg-blue-50 text-blue-700",
    delivered: "bg-green-50 text-green-700",
    opened: "bg-purple-50 text-purple-700",
    clicked: "bg-indigo-50 text-indigo-700",
    bounced: "bg-red-50 text-red-700",
    unsubscribed: "bg-orange-50 text-orange-700",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

// Drip enrollment status section
function LeadDripStatus({ leadId }: { leadId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: enrollment, isLoading } = useGetLeadDripEnrollment(leadId, { query: { queryKey: getGetLeadDripEnrollmentQueryKey(leadId) } });
  const { data: sequences } = useListDripSequences();
  const enroll = useEnrollLeadInDrip();
  const unenroll = useUnenrollLeadFromDrip();
  const [selectedSeq, setSelectedSeq] = useState<string>("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetLeadDripEnrollmentQueryKey(leadId) });
    queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
  };

  if (isLoading) return <Skeleton className="h-14 w-full" />;

  return (
    <div className="border rounded-lg p-3 bg-slate-50">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Drip Campaign</span>
      </div>
      {enrollment ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-700 font-medium">{(enrollment as any).sequence?.name ?? `Seq #${enrollment.sequenceId}`}</span>
            <Badge variant="outline" className="text-[10px]">Step {(enrollment as any).currentStep + 1} / {(enrollment as any).sequence?.steps ?? "?"}</Badge>
            <Badge className={`text-[10px] capitalize ${enrollment.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
              {enrollment.status}
            </Badge>
          </div>
          {(enrollment as any).nextSendAt && enrollment.status === "active" && (
            <p className="text-xs text-muted-foreground">
              Next email: <span className="font-medium text-slate-700">{format(new Date((enrollment as any).nextSendAt), "MMM d, h:mm a")}</span>
              {new Date((enrollment as any).nextSendAt) <= new Date() ? " (due now)" : ""}
            </p>
          )}
          {enrollment.status === "active" && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2"
              disabled={unenroll.isPending}
              onClick={() => unenroll.mutate({ id: leadId }, {
                onSuccess: () => { invalidate(); toast({ title: "Unenrolled from drip sequence" }); },
                onError: () => toast({ title: "Failed to unenroll", variant: "destructive" }),
              })}
            >
              Unenroll
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedSeq}
            onChange={(e) => setSelectedSeq(e.target.value)}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white flex-1 min-w-0"
          >
            <option value="">Select sequence…</option>
            {(sequences ?? []).filter((s: any) => s.isActive).map((s: any) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3"
            disabled={!selectedSeq || enroll.isPending}
            onClick={() => enroll.mutate({ id: leadId, data: { sequenceId: parseInt(selectedSeq) } }, {
              onSuccess: () => { setSelectedSeq(""); invalidate(); toast({ title: "Enrolled in drip sequence" }); },
              onError: () => toast({ title: "Failed to enroll", variant: "destructive" }),
            })}
          >
            <Zap className="h-3 w-3 mr-1" /> Enroll
          </Button>
        </div>
      )}
    </div>
  );
}

const NOTES_TRUNCATE = 140;
function CallNoteBlock({ notes }: { notes: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = notes.length > NOTES_TRUNCATE;
  const shown = !isLong || expanded ? notes : notes.slice(0, NOTES_TRUNCATE) + "…";
  return (
    <div className="mt-1 text-xs text-slate-600 bg-white/60 rounded px-2 py-1 border border-slate-100 italic space-y-0.5">
      <p className="whitespace-pre-wrap break-words">{shown}</p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[#1F4E79] font-medium not-italic hover:underline text-[11px]"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// Communications Tab
export function LeadCommunications() {
  const { id: leadId, lead } = useLeadDetail();
  const leadPhone = lead?.phone;
  const leadEmail = lead?.email;
  const { dial, pendingTextLeadId, clearTextComposer } = useContext(SoftphoneContext);
  const smsComposerRef = useRef<HTMLTextAreaElement>(null);
  const [smsBody, setSmsBody] = useState("");
  const [activeCompose, setActiveCompose] = useState<"sms" | "email">("sms");
  useEffect(() => {
    if (pendingTextLeadId !== leadId) return;
    setActiveCompose("sms");
    requestAnimationFrame(() => smsComposerRef.current?.focus());
    clearTextComposer();
  }, [pendingTextLeadId, leadId, clearTextComposer]);
  const { data: comms, isLoading: commsLoading } = useListCommunications(leadId, { query: { queryKey: getListCommunicationsQueryKey(leadId) } });
  const { data: emails, isLoading: emailsLoading } = useListLeadEmails(leadId, { query: { queryKey: getListLeadEmailsQueryKey(leadId) } });
  const { data: templates } = useListEmailTemplates();
  const sendSms = useSendSms();
  const sendEmail = useSendEmail();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const previewEmailTemplate = usePreviewEmailTemplate();
  const generateDraft = useGenerateAiDraft();
  const [emailMode, setEmailMode] = useState<"template" | "freeform">("template");
  const [emailTemplateId, setEmailTemplateId] = useState<string>("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyHtml, setEmailBodyHtml] = useState("");
  const [emailPreview, setEmailPreview] = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [draftInstruction, setDraftInstruction] = useState("");
  const [draftPopoverOpen, setDraftPopoverOpen] = useState<"sms" | "email" | null>(null);

  const handleGenerateDraft = (channel: "sms" | "email") => {
    generateDraft.mutate(
      { id: leadId, data: { channel: channel === "sms" ? AiDraftRequestChannel.sms : AiDraftRequestChannel.email, instruction: draftInstruction.trim() || undefined } },
      {
        onSuccess: (data: any) => {
          if (channel === "sms") {
            setSmsBody(data.body);
          } else {
            setEmailMode("freeform");
            setEmailSubject(data.subject ?? "");
            setEmailBodyHtml(data.body);
            setEmailPreview(null);
            setShowPreview(false);
          }
          setDraftInstruction("");
          setDraftPopoverOpen(null);
          toast({ title: "AI draft generated", description: "Review before sending." });
        },
        onError: () => toast({ title: "Error", description: "Failed to generate AI draft.", variant: "destructive" }),
      }
    );
  };

  const handlePreviewTemplate = () => {
    if (!emailTemplateId) return;
    previewEmailTemplate.mutate(
      { id: parseInt(emailTemplateId), data: { leadId } },
      {
        onSuccess: (data: any) => { setEmailPreview(data); setShowPreview(true); },
        onError: () => { setEmailPreview(null); setShowPreview(false); },
      }
    );
  };

  const insertVar = (v: string) => setEmailBodyHtml((p: string) => p + v);

  const handleSendSms = () => {
    if (!smsBody.trim()) return;
    sendSms.mutate({ id: leadId, data: { body: smsBody.trim() } }, {
      onSuccess: () => {
        setSmsBody("");
        toast({ title: "SMS Sent" });
        queryClient.invalidateQueries({ queryKey: getListCommunicationsQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: (err: any) => {
        toast({ title: "Failed to send SMS", description: err?.message ?? "Twilio may not be configured.", variant: "destructive" });
      },
    });
  };

  const handleSendEmail = () => {
    const isTemplate = emailMode === "template";
    if (isTemplate && !emailTemplateId) return;
    if (!isTemplate && (!emailSubject.trim() || !emailBodyHtml.trim())) return;

    const payload = isTemplate
      ? { leadId, templateId: parseInt(emailTemplateId) }
      : { leadId, subject: emailSubject.trim(), bodyHtml: emailBodyHtml.trim() };

    sendEmail.mutate({ data: payload }, {
      onSuccess: () => {
        setEmailTemplateId("");
        setEmailSubject("");
        setEmailBodyHtml("");
        setEmailPreview(null);
        setShowPreview(false);
        toast({ title: "Email Sent" });
        queryClient.invalidateQueries({ queryKey: getListLeadEmailsQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: (err: any) => {
        const msg = (err as any)?.response?.data?.error ?? err?.message ?? "Send failed";
        toast({ title: "Failed to send email", description: msg, variant: "destructive" });
      },
    });
  };

  if (commsLoading || emailsLoading) return <div className="mt-4 space-y-3"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div>;

  const hasNoEmail = !leadEmail;

  return (
    <div className="space-y-4 mt-4">
      {/* Call button */}
      {leadPhone && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <Phone className="h-4 w-4 text-blue-700" />
          <span className="text-sm font-medium text-blue-900 font-mono">{leadPhone}</span>
          <Button
            size="sm"
            className="ml-auto bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
            onClick={() => dial(leadPhone, { autoCall: true, leadId })}
          >
            <PhoneCall className="h-3 w-3 mr-1" /> Call
          </Button>
        </div>
      )}

      {/* Thread — calls + SMS */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {!comms || comms.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg text-sm">
            No calls or SMS yet.
          </div>
        ) : (
          comms.map((c) => {
            const isOutbound = c.direction === "outbound";
            const isCall = c.type === "call";
            return (
              <div
                key={c.id}
                className={`flex gap-3 rounded-xl p-3 border text-sm ${isOutbound ? "bg-blue-50 border-blue-100" : "bg-slate-50 border-slate-200"}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {isOutbound
                    ? <ArrowUpRight className="h-4 w-4 text-blue-600" />
                    : <ArrowDownLeft className="h-4 w-4 text-slate-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium capitalize">{c.type}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">{c.direction}</Badge>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{c.status}</Badge>
                    {isCall && c.durationSeconds != null && (
                      <span className="text-xs text-muted-foreground">{Math.floor(c.durationSeconds / 60)}m {c.durationSeconds % 60}s</span>
                    )}
                    {isCall && (c as any).callOutcome && (
                      <Badge
                        className={`text-[10px] h-4 px-1.5 capitalize ${
                          (c as any).callOutcome === "connected"
                            ? "bg-green-100 text-green-800 border-green-200"
                            : (c as any).callOutcome === "voicemail"
                            ? "bg-blue-100 text-blue-800 border-blue-200"
                            : (c as any).callOutcome === "no_answer" || (c as any).callOutcome === "busy"
                            ? "bg-amber-100 text-amber-800 border-amber-200"
                            : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                        variant="outline"
                      >
                        {((c as any).callOutcome as string).replace(/_/g, " ")}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">{format(new Date(c.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                  {c.body && <p className="mt-1 text-sm text-slate-700 break-words">{c.body}</p>}
                  {isCall && (c as any).callNotes && (
                    <CallNoteBlock notes={(c as any).callNotes} />
                  )}
                  {c.recordingUrl && <audio controls className="mt-2 w-full h-8" src={c.recordingUrl} />}
                  {c.user && <p className="mt-1 text-xs text-muted-foreground">via {getUserDisplayName(c.user)}</p>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Email thread */}
      {emails && emails.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MailCheck className="h-3.5 w-3.5 text-purple-500" />
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Emails</span>
          </div>
          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
            {emails.map((e: any) => (
              <div key={e.id} className="flex gap-3 rounded-xl p-3 border bg-purple-50 border-purple-100 text-sm">
                <MailOpen className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate max-w-[180px]">{e.subject}</span>
                    <EmailStatusBadge status={e.status} />
                    <span className="text-xs text-muted-foreground ml-auto">{format(new Date(e.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">To: {e.toEmail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compose toggle */}
      <div className="border-t pt-3">
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => setActiveCompose("sms")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeCompose === "sms" ? "bg-gradient-to-b from-[#1DB674] to-[#149258] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            <MessageSquare className="h-3 w-3" /> SMS
          </button>
          <button
            onClick={() => setActiveCompose("email")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeCompose === "email" ? "bg-gradient-to-b from-[#1DB674] to-[#149258] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"} ${hasNoEmail ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={hasNoEmail}
            title={hasNoEmail ? "Lead has no email address" : undefined}
          >
            <Mail className="h-3 w-3" /> Email
          </button>
        </div>

        {activeCompose === "sms" ? (
          <>
            <div className="flex justify-end">
              <Popover open={draftPopoverOpen === "sms"} onOpenChange={(o) => setDraftPopoverOpen(o ? "sms" : null)}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                    <Sparkles className="h-3 w-3" /> Draft with AI
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 space-y-2">
                  <p className="text-xs text-white/70">Optional instruction to guide the draft (e.g. "follow up after missed call")</p>
                  <Textarea
                    value={draftInstruction}
                    onChange={(e) => setDraftInstruction(e.target.value)}
                    placeholder="Instruction (optional)…"
                    className="min-h-[60px] resize-none border-white/20 bg-white/95 text-sm text-[#0E2A47] placeholder:text-slate-500"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleGenerateDraft("sms")}
                    disabled={generateDraft.isPending}
                    className="w-full text-xs"
                  >
                    {generateDraft.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                    Generate Draft
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-2">
              <Textarea
                ref={smsComposerRef}
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder="Type an SMS message…"
                className="min-h-[64px] text-sm resize-none flex-1"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSendSms(); }}
              />
              <Button onClick={handleSendSms} disabled={!smsBody.trim() || sendSms.isPending} className="self-end">
                <MessageSquare className="h-4 w-4 mr-1" /> Send
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter to send</p>
          </>
        ) : (
          <div className="space-y-2">
            {/* Template / Custom toggle */}
            <div className="flex gap-1">
              <button
                onClick={() => { setEmailMode("template"); setEmailPreview(null); setShowPreview(false); }}
                className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${emailMode === "template" ? "bg-gradient-to-b from-[#1DB674] to-[#149258] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                From Template
              </button>
              <button
                onClick={() => { setEmailMode("freeform"); setEmailPreview(null); setShowPreview(false); }}
                className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${emailMode === "freeform" ? "bg-gradient-to-b from-[#1DB674] to-[#149258] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                Custom
              </button>
            </div>

            {emailMode === "template" ? (
              <>
                <div className="flex gap-2">
                  <select
                    value={emailTemplateId}
                    onChange={(e) => { setEmailTemplateId(e.target.value); setEmailPreview(null); setShowPreview(false); }}
                    className="flex-1 text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="">Select an email template…</option>
                    {(templates ?? []).filter((t: any) => t.isActive).map((t: any) => (
                      <option key={t.id} value={String(t.id)}>{t.name}</option>
                    ))}
                  </select>
                  {emailTemplateId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePreviewTemplate}
                      disabled={previewEmailTemplate.isPending}
                      className="text-xs shrink-0"
                    >
                      Preview
                    </Button>
                  )}
                </div>
                {showPreview && emailPreview && (
                  <div className="border rounded-md p-3 bg-slate-50 text-xs space-y-1">
                    <div className="font-semibold text-slate-700">Subject: {emailPreview.subject}</div>
                    <div
                      className="text-slate-600 prose prose-sm max-h-[120px] overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: emailPreview.bodyHtml }}
                    />
                    <button onClick={() => setShowPreview(false)} className="text-purple-600 hover:underline text-[10px] mt-1">Hide preview</button>
                  </div>
                )}
                <Button
                  onClick={handleSendEmail}
                  disabled={!emailTemplateId || sendEmail.isPending}
                  className="w-full"
                >
                  <Mail className="h-4 w-4 mr-1.5" /> Send Email
                </Button>
              </>
            ) : (
              <>
                <div className="flex justify-end">
                  <Popover open={draftPopoverOpen === "email"} onOpenChange={(o) => setDraftPopoverOpen(o ? "email" : null)}>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                        <Sparkles className="h-3 w-3" /> Draft with AI
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 space-y-2">
                      <p className="text-xs text-white/70">Optional instruction to guide the draft (e.g. "ask for updated bank statements")</p>
                      <Textarea
                        value={draftInstruction}
                        onChange={(e) => setDraftInstruction(e.target.value)}
                        placeholder="Instruction (optional)…"
                        className="min-h-[60px] resize-none border-white/20 bg-white/95 text-sm text-[#0E2A47] placeholder:text-slate-500"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleGenerateDraft("email")}
                        disabled={generateDraft.isPending}
                        className="w-full text-xs"
                      >
                        {generateDraft.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                        Generate Draft
                      </Button>
                    </PopoverContent>
                  </Popover>
                </div>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject…"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
                />
                <RichTextEditor
                  value={emailBodyHtml}
                  onChange={setEmailBodyHtml}
                  placeholder="Compose your email…"
                  variables={["{{lead_first_name}}", "{{lead_company}}", "{{rep_name}}", "{{rep_email}}"]}
                  minHeight="100px"
                />
                <Button
                  onClick={handleSendEmail}
                  disabled={!emailSubject.trim() || !emailBodyHtml.trim() || sendEmail.isPending}
                  className="w-full"
                >
                  <Mail className="h-4 w-4 mr-1.5" /> Send Email
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Drip status */}
      <LeadDripStatus leadId={leadId} />
    </div>
  );
}

