import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search",
    label: "Search",
    description: "Search for content using the search service",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      return {
        content: [{ type: "text", text: "search tool工具调用测试成功，功能还在开发中" }],
        details: {},
      };
    },
  });
}
