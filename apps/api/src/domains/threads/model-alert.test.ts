import { describe, expect, it } from "vite-plus/test";

import { accountProblemOf } from "./model-alert";

describe("accountProblemOf", () => {
  it("reads OpenRouter's 402 as a lack of credit", () => {
    expect(
      accountProblemOf(
        '402 {"type":"error","error":{"type":"billing_error","message":"This request requires more credits, or fewer max_tokens."}}',
      ),
    ).toBe("credits");
  });

  it("reads a 401 as a key OpenRouter doesn't accept", () => {
    expect(accountProblemOf('401 {"error":{"message":"No auth credentials found"}}')).toBe("key");
  });

  it("leaves out failures of the call itself", () => {
    expect(accountProblemOf('400 {"error":{"message":"prompt is too long"}}')).toBeUndefined();
    expect(accountProblemOf("529 Overloaded")).toBeUndefined();
    expect(accountProblemOf("Network connection lost.")).toBeUndefined();
    expect(accountProblemOf(undefined)).toBeUndefined();
  });
});
