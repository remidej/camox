import { AttachedComments } from "./AttachedComments";

export function CommentSidebar({ pageId }: { pageId: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <AttachedComments pageId={pageId} allPageComments />
    </div>
  );
}
