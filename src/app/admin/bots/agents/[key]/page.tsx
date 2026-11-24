import { BotAgentEditor } from "@/components/admin/bot-agent-editor";

export default async function AdminBotAgentPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return <BotAgentEditor agentKey={key} />;
}
