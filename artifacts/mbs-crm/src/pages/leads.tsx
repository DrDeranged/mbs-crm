import { useState, useRef } from "react";
import { Link } from "wouter";
import { useListLeads, getListLeadsQueryKey, ListLeadsSortOrder } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Filter, Upload } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Leads() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<ListLeadsSortOrder>(ListLeadsSortOrder.desc);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  import("react").then((React) => {
    React.useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedSearch(search);
        setPage(1);
      }, 500);
      return () => clearTimeout(handler);
    }, [search]);
  });

  const queryParams = {
    search: debouncedSearch || undefined,
    status: status || undefined,
    page,
    limit: 20,
    sortBy: "updatedAt",
    sortOrder,
  };

  const { data, isLoading } = useListLeads(queryParams, { 
    query: { queryKey: getListLeadsQueryKey(queryParams) } 
  });

  const handleStatusChange = (val: string) => {
    setStatus(val === "all" ? "" : val);
    setPage(1);
  };

  const formatStatus = (status: string) => status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/api/leads/import", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) throw new Error("Import failed");
      
      const result = await res.json();
      toast({ 
        title: "Import Complete", 
        description: `Successfully imported ${result.imported} leads.` 
      });
      queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
    } catch (err) {
      toast({ 
        title: "Import Error", 
        description: "Failed to import leads from the file.", 
        variant: "destructive" 
      });
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Leads</h1>
          <p className="text-muted-foreground mt-1">Manage and track your financing pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          <Input 
            type="file" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleImport}
            accept=".csv,.xlsx,.xls"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Link href="/leads/new" className="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-blue-700">
            <Plus className="mr-2 h-4 w-4" />
            New Lead
          </Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search leads by name, email, company..."
            className="pl-9 w-full bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Select value={status || "all"} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-full sm:w-[180px] bg-white">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <SelectValue placeholder="Status" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new_lead">New Lead</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="application_received">App Received</SelectItem>
              <SelectItem value="submitted_to_underwriting">In Underwriting</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="funded">Funded</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as ListLeadsSortOrder)}>
            <SelectTrigger className="w-full sm:w-[140px] bg-white">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ListLeadsSortOrder.desc}>Newest First</SelectItem>
              <SelectItem value={ListLeadsSortOrder.asc}>Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-[100px] rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                </TableRow>
              ))
            ) : data?.leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No leads found.
                </TableCell>
              </TableRow>
            ) : (
              data?.leads.map((lead) => (
                <TableRow key={lead.id} className="cursor-pointer hover:bg-gray-50/50 transition-colors">
                  <TableCell className="font-medium">
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {lead.firstName} {lead.lastName}
                      <div className="text-xs text-muted-foreground font-normal">{lead.email}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">{lead.companyName || "-"}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      <Badge variant="secondary" className="font-normal capitalize">
                        {formatStatus(lead.status)}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full capitalize text-sm text-muted-foreground">
                      {lead.applicationType.replace('_', ' ')}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full text-sm text-muted-foreground">
                      {format(new Date(lead.updatedAt), 'MMM d, yyyy')}
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, data.total)} of {data.total} entries
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
