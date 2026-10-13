import { useSelector } from "@xstate/store-react";
import { useContext } from "react";

import { CMS_SIDEBAR_WIDTH } from "../previewConstants";
import { PreviewEditingOwnerContext } from "../previewSelection";
import {
  isBlockSelection,
  previewStore,
  selectIsCommentMode,
  selectionForOwner,
} from "../previewStore";
import { CommentSidebar } from "./CommentSidebar";
import { DerivedPageInfoSidebar } from "./DerivedPageInfoSidebar";
import { PageEditorSidebar } from "./PageEditorSidebar";
import { PageInfoSidebar } from "./PageInfoSidebar";

const RightSidebar = ({
  pageId,
  derivedLayoutId,
}: {
  pageId?: number;
  derivedLayoutId?: string;
}) => {
  const owner = useContext(PreviewEditingOwnerContext);
  const selection = useSelector(previewStore, (state) => selectionForOwner(state.context, owner));
  const isCommentMode = useSelector(previewStore, selectIsCommentMode);
  // A block, or a record page's record (which no block places), opens the editor.
  const editing = selection != null;
  if (pageId == null && derivedLayoutId == null && !isBlockSelection(selection)) return null;

  return (
    <aside
      className="bg-background relative flex shrink-0 flex-col border-l-2"
      style={{ width: CMS_SIDEBAR_WIDTH }}
    >
      {pageId != null && isCommentMode ? (
        <CommentSidebar key={pageId} pageId={pageId} />
      ) : editing ? (
        <PageEditorSidebar />
      ) : pageId != null ? (
        <PageInfoSidebar pageId={pageId} />
      ) : (
        <DerivedPageInfoSidebar layoutId={derivedLayoutId!} />
      )}
    </aside>
  );
};

export { RightSidebar };
