import { renderMarkdown } from "./markdown.js";

const API_URL = "http://localhost:3001/chat";

let sessionId = localStorage.getItem("sessionId");
let conversation = [];

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("chat-input");
const sendButtonEl = document.getElementById("chat-send");

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = inputEl.value.trim();
  if (!message) {
    return;
  }

  document.querySelector(".empty-state")?.remove();
  appendMessage("user", message);
  inputEl.value = "";
  setComposerDisabled(true);

  const assistantEl = appendMessage("assistant", "");
  assistantEl.innerHTML = typingIndicator();
  let assistantText = "";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId, conversation }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    await readStream(response.body, (streamEvent) => {
      assistantText = handleStreamEvent(streamEvent, assistantEl, assistantText);
    });
  } catch (error) {
    console.error(error);
    showError(assistantEl, "The chatbot is temporarily unavailable. Please try again.");
  } finally {
    setComposerDisabled(false);
    inputEl.focus();
  }
});

function setComposerDisabled(disabled) {
  inputEl.disabled = disabled;
  sendButtonEl.disabled = disabled;
}

function typingIndicator() {
  return '<span class="typing"><span></span><span></span><span></span></span>';
}

async function readStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop();

    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) {
        continue;
      }

      onEvent(JSON.parse(line.slice("data:".length).trim()));
    }
  }
}

function handleStreamEvent(streamEvent, assistantEl, assistantText) {
  switch (streamEvent.type) {
    case "start":
      sessionId = streamEvent.sessionId;
      localStorage.setItem("sessionId", sessionId);
      return assistantText;
    case "token": {
      const nextText = assistantText + streamEvent.value;
      assistantEl.innerHTML = renderMarkdown(nextText);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return nextText;
    }
    case "complete":
      conversation = streamEvent.conversation;
      return assistantText;
    case "error":
      showError(assistantEl, streamEvent.message);
      return assistantText;
    default:
      return assistantText;
  }
}

function appendMessage(role, text = "") {
  const label = { user: "You", assistant: "Assistant", error: "Error" }[role];
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.dataset.label = label;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function showError(el, message) {
  el.className = "message error";
  el.dataset.label = "Error";
  el.textContent = message;
}
