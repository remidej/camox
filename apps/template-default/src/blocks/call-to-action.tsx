import { createBlock } from "camox/createBlock";

import { Container } from "@/components/ui/container";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { colorSchemeSetting, Section } from "@/components/ui/section";

const callToAction = createBlock({
  id: "call-to-action",
  title: "Call to action",
  description:
    "Use this block to ask visitors to act, with a button that opens a dialog holding the details they need first, such as what's included, the terms or the next steps. Place it at the end of a page.",
  content: (field) => ({
    title: field.string({
      default: "Ready to get started?",
      title: "Title",
    }),
    description: field.string({
      default: "Find out what's included before you commit.",
      maxLength: 280,
      title: "Description",
    }),
    button: field.string({
      default: "See what's included",
      maxLength: 40,
      title: "Button",
    }),
    dialogTitle: field.string({
      default: "What's included",
      title: "Dialog title",
    }),
    dialogBody: field.string({
      default:
        "List what visitors get, the terms that apply, or the steps that come next. They read it without leaving the page.",
      title: "Dialog text",
    }),
    close: field.string({
      default: "Got it",
      maxLength: 40,
      title: "Close button",
    }),
  }),
  settings: (setting) => ({
    scheme: colorSchemeSetting(setting, "brand"),
  }),
  toReact: CallToActionComponent,
  toTitle: ({ content }) => content.title,
  toMarkdown: ({ content }) => [
    `# ${content.title}`,
    content.description,
    `## ${content.dialogTitle}`,
    content.dialogBody,
  ],
});

function CallToActionComponent() {
  const scheme = callToAction.useSetting("scheme");

  return (
    <Section scheme={scheme}>
      <Container className="max-w-text text-center">
        <callToAction.Field name="title">
          {(props) => <h2 {...props} className="text-heading mb-4" />}
        </callToAction.Field>
        <callToAction.Field name="description">
          {(props) => <p {...props} className="text-lead text-ink-muted mb-8" />}
        </callToAction.Field>
        <Dialog>
          <DialogTrigger size="lg">
            <callToAction.Field name="button">{(props) => <span {...props} />}</callToAction.Field>
          </DialogTrigger>
          <DialogContent className="text-left">
            <callToAction.Field name="dialogTitle">
              {(props) => <DialogTitle {...props} />}
            </callToAction.Field>
            <callToAction.Field name="dialogBody">
              {(props) => <p {...props} className="text-ink-muted text-base" />}
            </callToAction.Field>
            <DialogClose className="self-end">
              <callToAction.Field name="close">{(props) => <span {...props} />}</callToAction.Field>
            </DialogClose>
          </DialogContent>
        </Dialog>
      </Container>
    </Section>
  );
}

export { callToAction as block };
