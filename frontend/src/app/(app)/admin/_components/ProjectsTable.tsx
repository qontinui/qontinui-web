import { ChevronRight } from "lucide-react";
import type { AdminProjectData } from "@/hooks/use-admin";

interface ProjectsTableProps {
  projects: AdminProjectData[];
  loading: boolean;
}

function complexityLabel(states: number, transitions: number) {
  const total = states + transitions;
  if (total === 0) return { label: "Empty", color: "text-muted-foreground" };
  if (total <= 5) return { label: "Simple", color: "text-green-500" };
  if (total <= 15) return { label: "Medium", color: "text-yellow-500" };
  return { label: "Complex", color: "text-orange-500" };
}

export function ProjectsTable({ projects, loading }: ProjectsTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading projects...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        No projects found
      </div>
    );
  }

  return (
    <table className="w-full text-sm" data-ui-id="admin-projects-table">
      <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
        <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
          <th className="px-6 py-2 font-medium">Project</th>
          <th className="px-3 py-2 font-medium">Owner</th>
          <th className="px-3 py-2 font-medium">Complexity</th>
          <th className="px-3 py-2 font-medium text-right">States</th>
          <th className="px-3 py-2 font-medium text-right">Transitions</th>
          <th className="px-3 py-2 font-medium">Updated</th>
          <th className="px-6 py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {projects.map((project) => {
          const complexity = complexityLabel(
            project.state_count,
            project.transition_count
          );
          return (
            <tr
              key={project.id}
              className="hover:bg-muted/30 transition-colors"
              data-ui-id={`admin-project-row-${project.id}`}
            >
              <td className="px-6 py-2.5">
                <div>
                  <span className="font-medium">{project.name}</span>
                  {project.description && (
                    <div className="text-xs text-muted-foreground truncate max-w-xs">
                      {project.description}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5">
                <div className="text-xs">
                  <div>{project.owner_username}</div>
                  <div className="text-muted-foreground">
                    {project.owner_email}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <span className={`text-xs font-medium ${complexity.color}`}>
                  {complexity.label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {project.state_count}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {project.transition_count}
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">
                {new Date(project.updated_at).toLocaleDateString()}
              </td>
              <td className="px-6 py-2.5">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
