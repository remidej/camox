import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";
import * as Select from "@/components/ui/select";
import type { PublicationState } from "../previewStore";

const PublicationStateSelect = () => {
  const publicationState = useSelector(
    previewStore,
    (state) => state.context.publicationState,
  );

  return (
    <Select.Select
      value={publicationState}
      onValueChange={(value) => {
        previewStore.send({
          type: "setPublicationState",
          value: value as PublicationState,
        });
      }}
    >
      <Select.SelectTrigger>
        <Select.SelectValue />
        <Select.SelectContent>
          <Select.SelectItem value="draft">
            <span className="rounded-full w-2 h-2 bg-draft-accent" />
            Draft
          </Select.SelectItem>
          <Select.SelectItem value="published">
            <span className="rounded-full w-2 h-2 bg-published-accent" />
            Published
          </Select.SelectItem>
        </Select.SelectContent>
      </Select.SelectTrigger>
    </Select.Select>
  );
};

export { PublicationStateSelect };
