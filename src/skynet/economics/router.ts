export function routeToModel(taskSize: "small" | "medium" | "massive"): string {
  switch (taskSize) {
    case "small":
      console.log(`[Skynet] Active routing: utilizing cheap/fast LLM for small task.`);
      return "claude-3-haiku-20240307";
    case "massive":
      console.log(`[Skynet] Active routing: deploying 200k+ context model for massive task.`);
      return "claude-3-5-sonnet-20241022";
    default:
      return "claude-3-5-sonnet-20241022";
  }
}
