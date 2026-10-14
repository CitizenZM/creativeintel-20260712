import { Header } from "@/components/layout/header";
import { ProjectForm } from "@/components/projects/project-form";

export default function NewProjectPage() {
  return (
    <div>
      <Header
        title="New project"
        description="Set up a brand intelligence workspace"
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8 max-w-2xl mx-auto">
        <div className="rounded-lg border border-border bg-card p-6">
          <ProjectForm />
        </div>
      </div>
    </div>
  );
}
