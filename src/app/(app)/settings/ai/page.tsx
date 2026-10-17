import { Header } from "@/components/layout/header";
import { AiSettingsClient } from "@/components/settings/ai-settings-client";
import { getAiSettingsView } from "@/services/settings/ai-settings-view";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const view = await getAiSettingsView();
  return (
    <div>
      <Header
        title="AI engines"
        description="Pick the engine for each job, see what the free models allow, and connect your own paid model APIs."
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        <AiSettingsClient initial={view} />
      </div>
    </div>
  );
}
