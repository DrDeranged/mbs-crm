import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getUserDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getListLeadActivityQueryKey, getListNotesQueryKey, useCreateNote, useListNotes } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
// Notes Tab
export function LeadNotes() {
  const { id: leadId } = useLeadDetail();
  const { data: notes, isLoading } = useListNotes(leadId, { query: { queryKey: getListNotesQueryKey(leadId) } });
  const createNote = useCreateNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newNote, setNewNote] = useState("");

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    createNote.mutate({ id: leadId, data: { body: newNote } }, {
      onSuccess: () => {
        setNewNote("");
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: () => toast({ title: "Error", description: "Could not add note", variant: "destructive" })
    });
  };

  return (
    <div className="space-y-6 mt-4">
      <form onSubmit={handleAddNote} className="space-y-3 bg-white p-4 rounded-lg border shadow-sm">
        <Textarea 
          placeholder="Add a note about this deal..." 
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="min-h-[100px] resize-none"
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={createNote.isPending || !newNote.trim()}>
            {createNote.isPending ? "Adding..." : "Add Note"}
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        {isLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)
        ) : notes?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">No notes yet.</div>
        ) : (
          notes?.map((note) => (
            <div key={note.id} className="bg-white p-4 rounded-lg border shadow-sm space-y-2 min-w-0">
              <div className="flex flex-wrap justify-between items-start gap-2">
                <span className="font-medium text-sm truncate max-w-[150px] sm:max-w-[250px]" title={getUserDisplayName(note.author, "User")}>{getUserDisplayName(note.author, "User")}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(note.createdAt), 'MMM d, yyyy h:mm a')}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
