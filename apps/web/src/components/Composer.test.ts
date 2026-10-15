import { describe, expect, it } from "vitest";
import { resizeComposerInput, shouldSubmitOnEnter } from "./composerUtils.js";

describe("composer keyboard behavior", () => {
  const plainEnter = {
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
  };

  it("submits on plain Enter", () => {
    expect(shouldSubmitOnEnter(plainEnter)).toBe(true);
  });

  it("leaves Shift+Enter available to insert a newline", () => {
    expect(shouldSubmitOnEnter({ ...plainEnter, shiftKey: true })).toBe(false);
  });

  it("does not submit modified or IME composition Enter presses", () => {
    expect(shouldSubmitOnEnter({ ...plainEnter, ctrlKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...plainEnter, altKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...plainEnter, metaKey: true })).toBe(false);
    expect(shouldSubmitOnEnter({ ...plainEnter, isComposing: true })).toBe(false);
  });
});

describe("composer textarea sizing", () => {
  it("resets its previous height before fitting the current content", () => {
    const input = {
      style: { height: "192px" },
      get scrollHeight() {
        expect(this.style.height).toBe("auto");
        return 72;
      },
    };

    resizeComposerInput(input);

    expect(input.style.height).toBe("72px");
  });
});
