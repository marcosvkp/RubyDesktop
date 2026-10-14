import type { SkillSummary } from "@shared/ipc";

export interface SlashSuggestion {
  value: string;
  description: string;
  kind: "command" | "skill";
}

const commands: SlashSuggestion[] = [
  {
    value: "/help",
    description: "Mostrar comandos disponíveis",
    kind: "command",
  },
  {
    value: "/goal",
    description: "Ver ou definir a meta do workspace",
    kind: "command",
  },
  {
    value: "/compact",
    description: "Resumir mensagens antigas",
    kind: "command",
  },
  { value: "/mode", description: "Mudar o modo de permissão", kind: "command" },
  {
    value: "/plan",
    description: "Ativar o modo de planejamento",
    kind: "command",
  },
  {
    value: "/clear",
    description: "Iniciar uma conversa nova",
    kind: "command",
  },
];

/** Command recognition and autocomplete use the same list of valid commands. */
export function isKnownSlashCommand(text: string, skills: SkillSummary[]): boolean {
  if (!text.startsWith("/")) return false;
  const name = text.slice(1).trimStart().split(/\s+/, 1)[0]?.toLowerCase();
  if (!name) return false;
  return (
    commands.some((command) => command.value.slice(1) === name) ||
    skills.some((skill) => skill.name.toLowerCase() === name)
  );
}

const goalActions: SlashSuggestion[] = [
  {
    value: "/goal note",
    description: "Adicionar uma nota de progresso",
    kind: "command",
  },
  { value: "/goal pause", description: "Pausar a meta", kind: "command" },
  { value: "/goal resume", description: "Retomar a meta", kind: "command" },
  {
    value: "/goal auto",
    description: "Continuar a meta automaticamente",
    kind: "command",
  },
  {
    value: "/goal stop",
    description: "Interromper a continuação automática",
    kind: "command",
  },
  {
    value: "/goal max-rounds",
    description: "Definir o limite de rodadas automáticas",
    kind: "command",
  },
  {
    value: "/goal done",
    description: "Marcar a meta como concluída",
    kind: "command",
  },
  { value: "/goal clear", description: "Remover a meta", kind: "command" },
];

const permissionModes: SlashSuggestion[] = [
  {
    value: "/mode ask",
    description: "Pedir aprovação para ações",
    kind: "command",
  },
  {
    value: "/mode edits",
    description: "Aceitar edições automaticamente",
    kind: "command",
  },
  {
    value: "/mode plan",
    description: "Planejar sem editar arquivos",
    kind: "command",
  },
];

/** Suggestions for local commands and Skills discovered by the engine. */
export function getSlashSuggestions(
  text: string,
  skills: SkillSummary[],
): SlashSuggestion[] {
  if (!text.startsWith("/")) return [];

  const input = text.slice(1);
  const separator = input.search(/\s/);
  if (separator >= 0) {
    const command = input.slice(0, separator).toLowerCase();
    const query = input.slice(separator).trimStart().toLowerCase();
    const actions =
      command === "goal"
        ? goalActions
        : command === "mode"
          ? permissionModes
          : [];
    return actions.filter((item) =>
      item.value.slice(item.value.lastIndexOf(" ") + 1).startsWith(query),
    );
  }

  const query = input.toLowerCase();
  const skillSuggestions = skills
    .filter(
      (skill) =>
        !commands.some((command) => command.value === `/${skill.name}`),
    )
    .map((skill) => ({
      value: `/${skill.name}`,
      description: skill.description,
      kind: "skill" as const,
    }));

  return [...commands, ...skillSuggestions].filter((item) =>
    item.value.slice(1).startsWith(query),
  );
}
