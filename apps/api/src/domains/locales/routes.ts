import { runService } from "../../lib/run-service";
import { authed, contentWrite, pub } from "../../orpc";
import * as service from "./service";

// Locales are added and removed in the draft the request names, like content (ADR 0015).

const list = pub
  .input(service.listLocalesInput)
  .handler(({ context, input }) => runService(service.listLocales(context, input)));

const add = contentWrite
  .input(service.addLocaleInput)
  .handler(({ context, input }) => runService(service.addLocale(context, input)));

const remove = contentWrite
  .input(service.removeLocaleInput)
  .handler(({ context, input }) => runService(service.removeLocale(context, input)));

// Correcting the default locale's tag changes no content, so it needs no draft.
const setDefaultTag = authed
  .input(service.setDefaultLocaleTagInput)
  .handler(({ context, input }) => runService(service.setDefaultLocaleTag(context, input)));

export const localeProcedures = { list, add, remove, setDefaultTag };
