export type MessageArray = Array<{
  role: "system" | "user" | "assistant";
  content: string;
}>;
