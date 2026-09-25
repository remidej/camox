import { pub } from "../../orpc";
import { syncCollectionDefinitions, syncCollectionDefinitionsInput } from "./service";

// Intentionally no record operations here: this is not a public authoring ORM.
export const collectionDefinitionProcedures = {
  sync: pub
    .input(syncCollectionDefinitionsInput)
    .handler(({ context, input }) => syncCollectionDefinitions(context, input)),
};
