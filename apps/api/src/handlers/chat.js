export function createChatHandler({ chatService }) {
  return async function chatHandler(req, res) {
    const { message, sessionId, conversation = [] } = req.body ?? {};

    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const emit = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    await chatService.streamChat(
      { message: message.trim(), sessionId, conversation },
      emit,
    );

    res.end();
  };
}
