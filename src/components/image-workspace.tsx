"use client";

import { CircleHelp } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { DocumentWorkspace } from "@/components/document-workspace";
import { RasterWorkspace } from "@/components/raster-workspace";
import { Button } from "@/components/ui/button";
import { VectorWorkspace } from "@/components/vector-workspace";
import { WebAssetWorkspace } from "@/components/web-asset-workspace";
import { useLocalApiKey } from "@/hooks/use-local-api-key";
import { toolMeta, type Tool } from "@/lib/tools";

const AssetRecipeWorkspace = dynamic(() => import("@/components/asset-recipe-workspace").then((module) => module.AssetRecipeWorkspace));

export function ImageWorkspace() {
  const [tool, setTool] = useState<Tool>("web-assets");
  const [editingKey, setEditingKey] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const apiKey = useLocalApiKey();
  const meta = toolMeta(tool);

  function promptForApiKey() {
    setEditingKey(true);
  }

  function changeTool(next: Tool) {
    setTool(next);
    setHelpOpen(false);
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <AppSidebar tool={tool} onToolChange={changeTool} apiKey={apiKey} editingKey={editingKey} onEditingKeyChange={setEditingKey} />

      <main className="flex min-w-0 flex-col gap-5 px-5 py-6 sm:px-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{meta.heading}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{meta.description}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            aria-expanded={helpOpen}
            aria-controls="tool-help"
            onClick={() => setHelpOpen((open) => !open)}
          >
            <CircleHelp aria-hidden="true" />
            이 작업 설명 보기
          </Button>
        </header>

        {helpOpen ? (
          <ol id="tool-help" className="grid gap-2 rounded-xl border bg-card/60 p-4 text-sm leading-relaxed sm:grid-cols-2">
            {meta.help.map((line, index) => (
              <li key={line} className="flex gap-2.5 text-muted-foreground">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
                  {index + 1}
                </span>
                {line}
              </li>
            ))}
          </ol>
        ) : null}

        {tool === "web-assets" ? (
          <WebAssetWorkspace apiKey={apiKey} onUnauthorized={promptForApiKey} onNavigate={changeTool} />
        ) : tool === "recipes" ? (
          <AssetRecipeWorkspace apiKey={apiKey} onUnauthorized={promptForApiKey} />
        ) : tool === "raster" ? (
          <RasterWorkspace apiKey={apiKey} onUnauthorized={promptForApiKey} />
        ) : tool === "vector" ? (
          <VectorWorkspace apiKey={apiKey} onUnauthorized={promptForApiKey} />
        ) : (
          <DocumentWorkspace apiKey={apiKey} onUnauthorized={promptForApiKey} />
        )}
      </main>
    </div>
  );
}
