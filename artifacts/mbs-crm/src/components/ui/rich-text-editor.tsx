import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Bold, Italic, List, ListOrdered, Link2, Heading1, Heading2, Undo2, Redo2 } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  variables?: string[];
  minHeight?: string;
  className?: string;
  disabled?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Start typing…",
  variables,
  minHeight = "160px",
  className,
  disabled = false,
}: RichTextEditorProps) {
  const lastEmitted = useRef<string>(value);
  const [editorIsEmpty, setEditorIsEmpty] = useState(!value || value === "<p></p>");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastEmitted.current = html;
      setEditorIsEmpty(editor.isEmpty);
      onChange(html);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none px-3 py-2.5 text-sm leading-relaxed",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value !== lastEmitted.current) {
      editor.commands.setContent(value || "", false);
      lastEmitted.current = value;
      setEditorIsEmpty(editor.isEmpty);
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  const insertVariable = (v: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(v).run();
  };

  const handleAddLink = () => {
    if (!editor) return;
    const existing = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(existing ?? "https://");
    setLinkDialogOpen(true);
  };

  const confirmLink = () => {
    if (!editor) return;
    if (linkUrl && linkUrl !== "https://") {
      editor.chain().focus().setLink({ href: linkUrl }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setLinkDialogOpen(false);
    setLinkUrl("");
  };

  if (!editor) return null;

  return (
    <>
      <div
        className={cn(
          "border rounded-lg overflow-hidden bg-white",
          disabled && "opacity-60 pointer-events-none",
          className
        )}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 flex-wrap px-2 py-1 border-b bg-slate-50">
          <Toggle
            size="sm"
            pressed={editor.isActive("bold")}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
            title="Bold (Ctrl+B)"
            className="h-7 w-7 p-0 data-[state=on]:bg-slate-200"
          >
            <Bold className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("italic")}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (Ctrl+I)"
            className="h-7 w-7 p-0 data-[state=on]:bg-slate-200"
          >
            <Italic className="h-3.5 w-3.5" />
          </Toggle>

          <div className="w-px h-4 bg-slate-200 mx-0.5" />

          <Toggle
            size="sm"
            pressed={editor.isActive("heading", { level: 1 })}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            title="Heading 1"
            className="h-7 px-1.5 text-[10px] font-bold data-[state=on]:bg-slate-200"
          >
            H1
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("heading", { level: 2 })}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            title="Heading 2"
            className="h-7 px-1.5 text-[10px] font-bold data-[state=on]:bg-slate-200"
          >
            H2
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("heading", { level: 3 })}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            title="Heading 3"
            className="h-7 px-1.5 text-[10px] font-bold data-[state=on]:bg-slate-200"
          >
            H3
          </Toggle>

          <div className="w-px h-4 bg-slate-200 mx-0.5" />

          <Toggle
            size="sm"
            pressed={editor.isActive("bulletList")}
            onPressedChange={() =>
              editor.chain().focus().toggleBulletList().run()
            }
            title="Bullet list"
            className="h-7 w-7 p-0 data-[state=on]:bg-slate-200"
          >
            <List className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("orderedList")}
            onPressedChange={() =>
              editor.chain().focus().toggleOrderedList().run()
            }
            title="Numbered list"
            className="h-7 w-7 p-0 data-[state=on]:bg-slate-200"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </Toggle>

          <div className="w-px h-4 bg-slate-200 mx-0.5" />

          <Toggle
            size="sm"
            pressed={editor.isActive("link")}
            onPressedChange={handleAddLink}
            title="Insert / edit link"
            className="h-7 w-7 p-0 data-[state=on]:bg-slate-200"
          >
            <Link2 className="h-3.5 w-3.5" />
          </Toggle>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Variable chip row */}
        {variables && variables.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b bg-slate-50/70">
            <span className="text-[10px] text-muted-foreground font-medium shrink-0">
              Insert:
            </span>
            {variables.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="text-[10px] px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 rounded border border-blue-200 font-mono transition-colors cursor-pointer"
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {/* Editor area */}
        <div className="relative">
          {editorIsEmpty && (
            <div
              className="absolute top-0 left-0 px-3 py-2.5 text-sm text-muted-foreground pointer-events-none select-none"
              aria-hidden
            >
              {placeholder}
            </div>
          )}
          <div style={{ minHeight }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* Link dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Insert Link</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); confirmLink(); }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmLink}
              className="bg-[#1F4E79] hover:bg-[#163a5f] text-white"
            >
              {linkUrl && linkUrl !== "https://" ? "Apply" : "Remove Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
