type ComposerKeyboardState = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
};

export function shouldSubmitOnEnter(event: ComposerKeyboardState): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing
  );
}

export function resizeComposerInput(
  input: { style: { height: string }; scrollHeight: number },
) {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}
