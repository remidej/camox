import type { CamoxApp } from "../../core/createApp";
import type { Block } from "../../core/createBlock";
import { curatedLayoutContext } from "../../core/layoutContext";
import type { RendererAnswer, RendererQuestion } from "./protocol";

/** The block of `type` in the draft's code, loading it if it is lazy. */
export async function blockOfCode(camoxApp: CamoxApp, type: string): Promise<Block | undefined> {
  const block = camoxApp.getBlockById(type);
  if (block || !camoxApp.canLoadMoreBlocks()) return block;
  return camoxApp.loadBlock(type);
}

/** The answer the draft's code, `camoxApp`, gives the studio's question. */
export async function answerFromCode<Question extends RendererQuestion>(
  camoxApp: CamoxApp,
  question: Question,
): Promise<RendererAnswer<Question>>;
export async function answerFromCode(
  camoxApp: CamoxApp,
  question: RendererQuestion,
): Promise<RendererAnswer<RendererQuestion>> {
  switch (question.type) {
    case "initialBundle": {
      const block = await blockOfCode(camoxApp, question.blockType);
      return block?._internal.getInitialBundle() ?? null;
    }
    case "pageTitle": {
      const layout = camoxApp.getLayoutById(question.layoutId);
      if (!layout) return null;
      const { page, projectName, locale } = question;
      return layout._internal.toTitle(curatedLayoutContext({ page, projectName }, locale));
    }
  }
}
