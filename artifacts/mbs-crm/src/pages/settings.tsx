import { useState, useEffect } from "react";
import { useGetMe, getGetMeQueryKey, useListUsers, getListUsersQueryKey, useUpdateUser, useUpdateMyMobile } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRole, UserUpdateRole } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, Phone, Building2, Globe } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const { data: me, isLoading: loadingMe } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: users, isLoading: loadingUsers } = useListUsers({}, { query: { queryKey: getListUsersQueryKey() } });
  const updateUser = useUpdateUser();
  const updateMobile = useUpdateMyMobile();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [mobileInput, setMobileInput] = useState<string>("");
  const [mobileEditing, setMobileEditing] = useState(false);

  const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

  const [companyForm, setCompanyForm] = useState({
    companyName: "", companyEmail: "", companyPhone: "", companyWebsite: "",
    companyAddress: "", companyCity: "", companyState: "", companyZip: "",
  });
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);

  useEffect(() => {
    if (me?.role !== "admin") return;
    setLoadingCompany(true);
    fetch(`${apiBase}/settings/company`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string | null>) => setCompanyForm({
        companyName: data.companyName ?? "",
        companyEmail: data.companyEmail ?? "",
        companyPhone: data.companyPhone ?? "",
        companyWebsite: data.companyWebsite ?? "",
        companyAddress: data.companyAddress ?? "",
        companyCity: data.companyCity ?? "",
        companyState: data.companyState ?? "",
        companyZip: data.companyZip ?? "",
      }))
      .catch(() => {})
      .finally(() => setLoadingCompany(false));
  }, [me]);

  const handleSaveCompany = async () => {
    setSavingCompany(true);
    try {
      const res = await fetch(`${apiBase}/settings/company`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(companyForm),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Company settings saved" });
    } catch {
      toast({ title: "Failed to save company settings", variant: "destructive" });
    } finally {
      setSavingCompany(false);
    }
  };

  const handleRoleChange = (userId: number, newRole: UserUpdateRole) => {
    updateUser.mutate({ id: userId, data: { role: newRole } }, {
      onSuccess: () => {
        toast({ title: "Role Updated", description: "User role has been updated." });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update user role.", variant: "destructive" });
      }
    });
  };

  const handleEditMobile = () => {
    setMobileInput(me?.mobileNumber ?? "");
    setMobileEditing(true);
  };

  const handleSaveMobile = () => {
    updateMobile.mutate(
      { data: { mobileNumber: mobileInput.trim() || null } },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "Call forwarding number updated." });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          setMobileEditing(false);
        },
        onError: () => toast({ title: "Error", description: "Failed to save mobile number.", variant: "destructive" }),
      }
    );
  };

  const isAdmin = me?.role === UserRole.admin;

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">Manage your account and organization settings.</p>
      </div>

      <div className="grid gap-8">
        <Card>
          <CardHeader>
            <CardTitle>My Profile</CardTitle>
            <CardDescription>Your personal account information.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMe ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-[250px]" />
                <Skeleton className="h-4 w-[200px]" />
              </div>
            ) : me ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Name</div>
                  <div className="font-medium">{me.name || "N/A"}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Email</div>
                  <div className="font-medium">{me.email}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Role</div>
                  <Badge variant="outline" className="capitalize">{me.role}</Badge>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Member Since</div>
                  <div className="font-medium">{format(new Date(me.createdAt), 'MMM d, yyyy')}</div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Call Forwarding */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-[#1F4E79]" />
              Call Forwarding
            </CardTitle>
            <CardDescription>
              When your browser is offline, inbound calls will simultaneously ring this mobile number.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMe ? (
              <Skeleton className="h-10 w-[280px]" />
            ) : mobileEditing ? (
              <div className="flex items-center gap-3 max-w-sm">
                <Input
                  type="tel"
                  value={mobileInput}
                  onChange={(e) => setMobileInput(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="font-mono"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveMobile(); if (e.key === "Escape") setMobileEditing(false); }}
                  autoFocus
                />
                <Button onClick={handleSaveMobile} disabled={updateMobile.isPending} size="sm" className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                  {updateMobile.isPending ? "Saving…" : "Save"}
                </Button>
                <Button onClick={() => setMobileEditing(false)} variant="ghost" size="sm">Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="text-sm font-mono font-medium">
                  {me?.mobileNumber || <span className="text-muted-foreground">Not configured</span>}
                </div>
                <Button variant="outline" size="sm" onClick={handleEditMobile}>
                  {me?.mobileNumber ? "Change" : "Add number"}
                </Button>
                {me?.mobileNumber && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700"
                    onClick={() => updateMobile.mutate({ data: { mobileNumber: null } }, {
                      onSuccess: () => {
                        toast({ title: "Removed", description: "Call forwarding number removed." });
                        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
                      }
                    })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[#1F4E79]" />
                Company Settings
              </CardTitle>
              <CardDescription>Contact details and branding for your organization.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCompany ? (
                <div className="space-y-3 max-w-2xl">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">Company Name</label>
                    <Input value={companyForm.companyName} onChange={(e) => setCompanyForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="MBS Financial" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">Contact Email</label>
                    <Input type="email" value={companyForm.companyEmail} onChange={(e) => setCompanyForm((f) => ({ ...f, companyEmail: e.target.value }))} placeholder="contact@company.com" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">Phone</label>
                    <Input type="tel" value={companyForm.companyPhone} onChange={(e) => setCompanyForm((f) => ({ ...f, companyPhone: e.target.value }))} placeholder="+1 (800) 000-0000" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" /> Website</label>
                    <Input type="url" value={companyForm.companyWebsite} onChange={(e) => setCompanyForm((f) => ({ ...f, companyWebsite: e.target.value }))} placeholder="https://company.com" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-sm font-medium text-muted-foreground">Street Address</label>
                    <Input value={companyForm.companyAddress} onChange={(e) => setCompanyForm((f) => ({ ...f, companyAddress: e.target.value }))} placeholder="123 Main St" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">City</label>
                    <Input value={companyForm.companyCity} onChange={(e) => setCompanyForm((f) => ({ ...f, companyCity: e.target.value }))} placeholder="New York" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">State</label>
                      <Input value={companyForm.companyState} onChange={(e) => setCompanyForm((f) => ({ ...f, companyState: e.target.value }))} placeholder="NY" maxLength={2} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">ZIP</label>
                      <Input value={companyForm.companyZip} onChange={(e) => setCompanyForm((f) => ({ ...f, companyZip: e.target.value }))} placeholder="10001" maxLength={10} />
                    </div>
                  </div>
                  <div className="sm:col-span-2 pt-2">
                    <Button onClick={handleSaveCompany} disabled={savingCompany} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                      {savingCompany ? "Saving…" : "Save Company Settings"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Manage user roles within your organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingUsers ? (
                      [...Array(3)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell><Skeleton className="h-8 w-[120px]" /></TableCell>
                        </TableRow>
                      ))
                    ) : users?.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name || "User"}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell className="text-muted-foreground">{format(new Date(user.createdAt), 'MMM d, yyyy')}</TableCell>
                        <TableCell>
                          <Select
                            value={user.role}
                            onValueChange={(val) => handleRoleChange(user.id, val as UserUpdateRole)}
                            disabled={user.id === me?.id || updateUser.isPending}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UserUpdateRole.admin}>Admin</SelectItem>
                              <SelectItem value={UserUpdateRole.manager}>Manager</SelectItem>
                              <SelectItem value={UserUpdateRole.rep}>Rep</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
              <ShieldAlert className="h-12 w-12 mb-4 text-muted-foreground/50" />
              <p>You need administrator privileges to manage organizational settings.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
