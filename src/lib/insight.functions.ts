import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  question: z.string().min(1).max(500),
  datasetSummary: z.string().max(4000),
  computed: z.string().max(8000),
});

export const explainInsight = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const { generateExplanation } = await import("./ai/responses.server");

    const system = [
      "You are the explanation layer of a business decision engine.",
      "All numbers have ALREADY been calculated from the user's dataset with deterministic code.",
      "You must never invent, re-estimate, or change a number. Use only the figures provided.",
      "Never claim causation; write 'the data suggests', 'the observed pattern is', 'based on the available data'.",
      "If the computed facts are insufficient, say there is not enough evidence in the uploaded dataset.",
      "Reply in EXACTLY this format, with these uppercase labels on their own lines and no markdown:",
      "ANSWER:",
      "<2-3 sentences answering the question in business language>",
      "REASONING:",
      "<how the conclusion follows from the computed values and the aggregation used>",
      "BUSINESS IMPACT:",
      "<why it matters commercially>",
      "RECOMMENDATION:",
      "<one practical action supported only by this data>",
    ].join("\n");

    const user = [
      `QUESTION: ${data.question}`,
      "",
      "DATASET SUMMARY:",
      data.datasetSummary,
      "",
      "COMPUTED FACTS (authoritative, computed in code):",
      data.computed,
    ].join("\n");

    try {
      const text = await generateExplanation([
        { role: "system", content: system },
        { role: "user", content: user },
      ]);
      return { ok: true as const, text };
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI explanation failed.";
      return { ok: false as const, text: "", error: message };
    }
  });
