import OpenAI from "openai";

export class Agent {
  constructor({ systemPrompt, model, client } = {}) {
    if (!systemPrompt) {
      throw new Error("Agent requires a systemPrompt");
    }

    this.systemPrompt = systemPrompt;
    this.model = model;
    this.client = client ?? new OpenAI();
  }

  async send(message, { conversation = [] } = {}, onToken = () => {}) {
    const input =
      conversation.length === 0
        ? message
        : [...conversation, { role: "user", content: message }];

    const stream = this.client.responses.stream({
      model: this.model,
      instructions: this.systemPrompt,
      input,
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        onToken(event.delta);
      }
    }

    const response = await stream.finalResponse();
    const answer = response.output_text;
    const userMessage = { role: "user", content: message };

    return {
      answer,
      conversation: [
        ...conversation,
        userMessage,
        { role: "assistant", content: answer },
      ],
    };
  }
}
