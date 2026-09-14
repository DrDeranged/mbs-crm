import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Plus } from "lucide-react";
import { getListLeadActivityQueryKey, getListTasksQueryKey, useCreateTask, useListTasks, useUpdateTask } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
// Tasks Tab
export function LeadTasks() {
  const { id: leadId } = useLeadDetail();
  const { data: tasks, isLoading } = useListTasks(leadId, { query: { queryKey: getListTasksQueryKey(leadId) } });
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask.mutate({ id: leadId, data: { title, dueDate: dueDate || undefined } }, {
      onSuccess: () => {
        setTitle("");
        setDueDate("");
        setIsOpen(false);
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: () => toast({ title: "Error", description: "Could not create task", variant: "destructive" })
    });
  };

  const handleToggle = (taskId: number, isCompleted: boolean) => {
    updateTask.mutate({ taskId, data: { isCompleted: !isCompleted } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(leadId) });
      }
    });
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Checklist & Tasks</h3>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-2" /> New Task</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Task</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Task Title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Follow up on bank statements..." autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Due Date (Optional)</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={createTask.isPending || !title.trim()}>Save Task</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          [1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)
        ) : tasks?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">No tasks assigned.</div>
        ) : (
          tasks?.map((task) => (
            <div key={task.id} className={`flex items-start gap-3 bg-white p-3 rounded-lg border shadow-sm transition-opacity min-w-0 ${task.isCompleted ? 'opacity-60' : ''}`}>
              <Checkbox 
                checked={task.isCompleted} 
                onCheckedChange={() => handleToggle(task.id, task.isCompleted)} 
                className="mt-1 shrink-0"
              />
              <div className="flex-1 space-y-1 min-w-0">
                <p className={`text-sm font-medium break-words [overflow-wrap:anywhere] ${task.isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                  {task.title}
                </p>
                {task.dueDate && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarIcon className="w-3 h-3 shrink-0" /> {format(new Date(task.dueDate), 'MMM d, yyyy')}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
