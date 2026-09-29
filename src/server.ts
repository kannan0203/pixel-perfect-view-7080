import "./lib/error-capture";

import { answerQuestion } from "./lib/query-engine";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { z } from "zod";

const analyticsRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    columns: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    rows: z
      .array(
        z.record(z.string(), z.union([z.string().max(2000), z.number().finite(), z.null()])),
      )
      .min(1)
      .max(5000),
  })
  .strict()
  .superRefine(({ columns }, context) => {
    if (new Set(columns).size !== columns.length) {
      context.addIssue({ code: "custom", message: "Column names must be unique.", path: ["columns"] });
    }
  });

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (new URL(request.url).pathname === "/api/health") {
        if (request.method !== "GET") {
          return Response.json(
            { error: "Method not allowed" },
            { status: 405, headers: { allow: "GET" } },
          );
        }

        return Response.json(
          { status: "ok", service: "BizInsight AI" },
          { headers: { "cache-control": "no-store" } },
        );
      }

      if (new URL(request.url).pathname === "/api/analytics") {
        if (request.method !== "POST") {
          return Response.json(
            { error: "Method not allowed" },
            { status: 405, headers: { allow: "POST" } },
          );
        }

        const contentLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
          return Response.json({ error: "Request body exceeds the 2 MB limit." }, { status: 413 });
        }

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
        }

        const parsed = analyticsRequestSchema.safeParse(payload);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid analytics request.", details: parsed.error.issues },
            { status: 400 },
          );
        }

        const { question, columns, rows } = parsed.data;
        const dataset = {
          fileName: "api-request",
          columns,
          rows: rows.map((row) =>
            Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
          ),
        };

        try {
          return Response.json(answerQuestion(question, dataset));
        } catch {
          return Response.json({ error: "Unable to analyze this dataset." }, { status: 422 });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
