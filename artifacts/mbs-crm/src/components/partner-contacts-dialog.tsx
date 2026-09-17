import { useState, useContext } from "react";
import { usePartnerContacts, useCreatePartnerContact, useUpdatePartnerContact, useDeletePartnerContact, PartnerContact } from "@/hooks/use-partner-contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SoftphoneContext } from "@/components/softphone-context";
import { Phone, MessageSquare, Copy, Pencil, Trash2, Plus, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBaseUrl } from "@/lib/apiBase";

export function PartnerContactsDialog({ partnerId, partnerName, dealId }: { partnerId: number, partnerName: string, dealId?: number }) {
  const { data: contacts = [], isLoading } = usePartnerContacts(partnerId);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<PartnerContact>>({});
  
  const createContact = useCreatePartnerContact(partnerId);
  const updateContact = useUpdatePartnerContact(partnerId);
  const deleteContact = useDeletePartnerContact(partnerId);
  const { toast } = useToast();
  const [smsContact, setSmsContact] = useState<PartnerContact | null>(null);
  const [smsBody, setSmsBody] = useState("");
  const [smsSending, setSmsSending] = useState(false);

  const handleEdit = (contact: PartnerContact) => {
    setEditingId(contact.id);
    setForm(contact);
  };

  const handleNew = () => {
    setEditingId(0);
    setForm({ role: "rep", name: "", email: "", phone: "", isPrimary: false, notes: "" });
  };

  const handleSave = () => {
    if (!form.name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    
    if (editingId === 0) {
      createContact.mutate(form as any, {
        onSuccess: () => {
          setEditingId(null);
          toast({ title: "Contact added" });
        }
      });
    } else if (editingId) {
      updateContact.mutate({ contactId: editingId, data: form }, {
        onSuccess: () => {
          setEditingId(null);
          toast({ title: "Contact updated" });
        }
      });
    }
  };

  const sendPartnerSms = async () => {
    if (!smsContact || !smsBody.trim()) return;
    setSmsSending(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/partners/${partnerId}/contacts/${smsContact.id}/sms`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: smsBody.trim(), ...(dealId ? { dealId } : {}) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || "Unable to send partner SMS");
      toast({ title: "Message sent" });
      setSmsBody("");
      setSmsContact(null);
    } catch (error) {
      toast({ title: "Message not sent", description: error instanceof Error ? error.message : "Unable to send partner SMS", variant: "destructive" });
    } finally {
      setSmsSending(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2 gap-1.5 border-slate-200">
          <Users className="h-3.5 w-3.5" />
          Manage Contacts ({contacts.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contacts for {partnerName}</DialogTitle>
        </DialogHeader>
        
        {editingId !== null ? (
          <div className="space-y-4 border rounded-lg p-4 bg-slate-50/50">
            <h4 className="font-semibold text-sm">{editingId === 0 ? "New Contact" : "Edit Contact"}</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Name *</Label>
                <Input value={form.name || ""} onChange={e => setForm({...form, name: e.target.value})} className="mt-1 bg-white" />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={form.role || "rep"} onValueChange={(v: any) => setForm({...form, role: v})}>
                  <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rep">Account Rep</SelectItem>
                    <SelectItem value="submissions">Submissions</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                    <SelectItem value="docs">Docs</SelectItem>
                    <SelectItem value="funding">Funding</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email || ""} onChange={e => setForm({...form, email: e.target.value})} className="mt-1 bg-white" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone || ""} onChange={e => setForm({...form, phone: e.target.value})} className="mt-1 bg-white" />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes || ""} onChange={e => setForm({...form, notes: e.target.value})} className="mt-1 bg-white" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
              <Button onClick={handleSave} className="bg-[#1F4E79] text-white">Save Contact</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" onClick={handleNew} className="bg-[#1F4E79] text-white gap-1.5"><Plus className="h-3.5 w-3.5"/> Add Contact</Button>
          </div>
        )}

        {isLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading contacts...</div>
        ) : contacts.length === 0 && editingId === null ? (
          <div className="py-8 text-center text-sm text-slate-500 border rounded-lg border-dashed">No contacts added yet.</div>
        ) : (
          <div className="grid gap-3">
            {contacts.map(contact => (
              <div key={contact.id} className="flex items-start justify-between p-3 border rounded-lg hover:border-slate-300 transition-colors bg-white">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{contact.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium uppercase tracking-wider">{contact.role}</span>
                    {contact.isPrimary && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">PRIMARY</span>}
                  </div>
                  <div className="flex flex-col gap-1 mt-2 text-xs text-slate-600">
                    {contact.email && (
                      <div className="flex items-center justify-between">
                        <div><span className="font-medium text-slate-400 w-12 inline-block">EMAIL</span> {contact.email}</div>
                        <ContactAffordances contact={contact} email={contact.email} onText={setSmsContact} />
                      </div>
                    )}
                    {contact.phone && (
                      <div className="flex items-center justify-between">
                        <div><span className="font-medium text-slate-400 w-12 inline-block">PHONE</span> {contact.phone}</div>
                        <ContactAffordances contact={contact} phone={contact.phone} onText={setSmsContact} />
                      </div>
                    )}
                    {contact.notes && <div className="mt-1 text-slate-500">{contact.notes}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700" onClick={() => handleEdit(contact)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => {
                    if (confirm("Delete this contact?")) deleteContact.mutate(contact.id);
                  }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
      <Dialog open={!!smsContact} onOpenChange={(value) => !value && setSmsContact(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Text {smsContact?.name || "partner contact"}</DialogTitle></DialogHeader>
          <Textarea value={smsBody} onChange={(event) => setSmsBody(event.target.value)} placeholder="Write a business-contact message" />
          <div className="flex justify-end"><Button onClick={() => void sendPartnerSms()} disabled={!smsBody.trim() || smsSending}>{smsSending ? "Sending…" : "Send message"}</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ContactAffordances({ contact, phone, email, onText }: { contact: PartnerContact, phone?: string | null, email?: string | null, onText: (contact: PartnerContact) => void }) {
  const { dial } = useContext(SoftphoneContext);
  const { toast } = useToast();

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard", description: text });
  };

  return (
    <div className="flex items-center gap-1">
      {phone && (
        <>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-blue-600 hover:bg-blue-50" onClick={() => dial(phone)} title="Call">
            <Phone className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-600" onClick={() => handleCopy(phone)} title="Copy Phone">
            <Copy className="h-3 w-3" />
          </Button>
           <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-green-600 hover:bg-green-50" onClick={() => onText(contact)} title={`Text ${contact.name}`}>
            <MessageSquare className="h-3 w-3" />
          </Button>
        </>
      )}
      {email && (
        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-600" onClick={() => handleCopy(email)} title="Copy Email">
          <Copy className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
