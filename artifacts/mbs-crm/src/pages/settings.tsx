import { useState } from "react";
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
import { ShieldAlert, Phone } from "lucide-react";
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
    <div className="flex-1 overflow-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and organization settings.</p>
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
              <div className="grid grid-cols-2 gap-4 max-w-xl">
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

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Manage user roles within your organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
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
